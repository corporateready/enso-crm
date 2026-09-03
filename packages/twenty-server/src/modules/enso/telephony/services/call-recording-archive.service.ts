import { Injectable, Logger } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { FileFolder } from 'twenty-shared/types';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { TWENTY_STANDARD_APPLICATION } from 'src/engine/workspace-manager/twenty-standard-application/constants/twenty-standard-applications';
import { SYSTEM_ACTOR } from 'src/modules/enso/lead-pipeline/lead-pipeline.constants';
import {
  RECORDING_FETCH_TIMEOUT_MS,
  RECORDING_MAX_BYTES,
} from 'src/modules/enso/telephony/telephony.constants';

type ActorValue = { source: string; name: string; context?: object };

type FileItem = { fileId: string; label: string; extension: string };

type AttachmentRow = {
  id: string;
  name?: string | null;
  file?: FileItem[] | null;
  fileCategory?: string | null;
  position: number;
  createdBy?: ActorValue | null;
  updatedBy?: ActorValue | null;
  targetInboundActivityId?: string | null;
  targetOutboundActivityId?: string | null;
  targetPersonId?: string | null;
  targetOpportunityId?: string | null;
};

export type RecordingTarget = {
  // Which activity object owns the recording. Both have an `attachments`
  // relation, reached through the matching morph column on attachment.
  objectNameSingular: 'inboundActivity' | 'outboundActivity';
  activityId: string;
  personId?: string;
  opportunityId?: string;
  occurredAt?: Date;
};

// Copies a call recording out of the PBX and into the workspace's own file
// storage, attached to the activity.
//
// Two reasons this is not optional:
//   - The PBX keeps recordings for roughly a week, so a link stored on the
//     activity goes dead and the audio is gone for good.
//   - Verified against a live recording: the PBX serves the file over an
//     UNAUTHENTICATED url. Anyone who ever sees the link — in a log, in an
//     export, over someone's shoulder — can listen to the call. An attachment is
//     reachable only through a signed CRM url.
//
// The original link stays on the activity as provenance; the attachment is the
// durable copy.
@Injectable()
export class CallRecordingArchiveService {
  private readonly logger = new Logger(CallRecordingArchiveService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly fileStorageService: FileStorageService,
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {}

  // Returns true when the recording is now archived (or already was). A false
  // return means "try again later" — the PBX writes the file after the call
  // ends, so `history` can beat the audio to disk.
  async archive(
    workspaceId: string,
    recordingUrl: string,
    target: RecordingTarget,
  ): Promise<boolean> {
    if (await this.isAlreadyArchived(workspaceId, target)) {
      return true;
    }

    const audio = await this.fetchRecording(workspaceId, recordingUrl);

    if (!isDefined(audio)) {
      return false;
    }

    const fileId = randomUUID();
    const extension = this.extensionFor(recordingUrl, audio.mimeType);
    const label = this.buildLabel(target, extension);

    // Files behind a FILES field live under the field's universal identifier,
    // keyed by fileId — the same layout the attachment upload path and the
    // seeder use. Not FileFolder.Attachment, which is the legacy fullPath world.
    await this.fileStorageService.writeFile({
      sourceFile: audio.buffer,
      mimeType: audio.mimeType,
      fileFolder: FileFolder.FilesField,
      applicationUniversalIdentifier:
        TWENTY_STANDARD_APPLICATION.universalIdentifier,
      workspaceId,
      resourcePath: `${STANDARD_OBJECTS.attachment.fields.file.universalIdentifier}/${fileId}.${extension}`,
      fileId,
      // MUST be written as temporary. The files-field insert path refuses a file
      // that is already permanent ("already associated with a permanent files
      // field") and flips this to false itself once the attachment row lands.
      settings: { isTemporaryFile: true, toDelete: false },
    });

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<AttachmentRow>(
          workspaceId,
          'attachment',
          { shouldBypassPermissionChecks: true },
        );

      const lastPosition = await repository.maximum('position', undefined);

      await repository.insert({
        id: randomUUID(),
        name: label,
        // The ORM rewrites `extension` from the stored file's own path, and
        // flips the file from temporary to permanent, as part of this insert.
        file: [{ fileId, label, extension }],
        fileCategory: 'AUDIO',
        ...this.targetColumns(target),
        position: (lastPosition ?? 0) + 1,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      });
    }, buildSystemAuthContext(workspaceId));

    this.logger.log(
      `Archived ${audio.buffer.length} B recording for ${target.objectNameSingular} ${target.activityId}`,
    );

    return true;
  }

  // Idempotency is per activity rather than per url: one call has exactly one
  // recording, and the same `history` push can be redelivered. Narrowed to AUDIO
  // so a file somebody attached to the activity by hand does not read as "the
  // recording is already here".
  private async isAlreadyArchived(
    workspaceId: string,
    target: RecordingTarget,
  ): Promise<boolean> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<AttachmentRow>(
            workspaceId,
            'attachment',
            { shouldBypassPermissionChecks: true },
          );

        const existing = await repository.findOne({
          where: { ...this.targetColumns(target), fileCategory: 'AUDIO' },
        });

        return isDefined(existing);
      },
      buildSystemAuthContext(workspaceId),
    );
  }

  private async fetchRecording(
    workspaceId: string,
    recordingUrl: string,
  ): Promise<{ buffer: Buffer; mimeType: string } | undefined> {
    // Fetched through the SSRF-safe client: the url comes from a third party (a
    // PBX push we authenticate only with a shared token), so it must never be
    // able to make the server reach an internal address.
    const client = this.secureHttpClientService.getHttpClient(
      {
        timeout: RECORDING_FETCH_TIMEOUT_MS,
        responseType: 'arraybuffer',
        maxContentLength: RECORDING_MAX_BYTES,
        // A recording behind a redirect is still a recording, but the response
        // must be audio in the end — checked below.
        validateStatus: (status) => status === 200,
      },
      { workspaceId, source: 'moldcell-pbx' },
    );

    try {
      const response = await client.get<ArrayBuffer>(recordingUrl);
      const buffer = Buffer.from(response.data);

      if (buffer.length === 0) {
        this.logger.warn(`Recording ${recordingUrl} is empty — will retry`);

        return undefined;
      }

      const contentType = String(
        response.headers['content-type'] ?? '',
      ).toLowerCase();

      // An HTML error page returned with a 200 is the classic failure here; it
      // would otherwise be filed as an unplayable "recording".
      if (!contentType.startsWith('audio/')) {
        this.logger.warn(
          `Recording ${recordingUrl} returned ${contentType || 'no content type'}, not audio — will retry`,
        );

        return undefined;
      }

      return { buffer, mimeType: contentType.split(';')[0] };
    } catch (error) {
      this.logger.warn(
        `Could not download recording ${recordingUrl}: ${(error as Error).message}`,
      );

      return undefined;
    }
  }

  private targetColumns(target: RecordingTarget): Record<string, string> {
    return target.objectNameSingular === 'inboundActivity'
      ? { targetInboundActivityId: target.activityId }
      : { targetOutboundActivityId: target.activityId };
  }

  private extensionFor(recordingUrl: string, mimeType: string): string {
    const fromUrl = recordingUrl.split('?')[0].split('.').pop();

    if (isDefined(fromUrl) && /^[a-z0-9]{2,5}$/i.test(fromUrl)) {
      return fromUrl.toLowerCase();
    }

    return mimeType === 'audio/wav' ? 'wav' : 'mp3';
  }

  private buildLabel(target: RecordingTarget, extension: string): string {
    const stamp = (target.occurredAt ?? new Date())
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    return `Call recording ${stamp}.${extension}`;
  }
}
