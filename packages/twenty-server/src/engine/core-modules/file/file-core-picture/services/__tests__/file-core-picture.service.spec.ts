import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { FileCorePictureService } from 'src/engine/core-modules/file/file-core-picture/services/file-core-picture.service';
import { FileUrlService } from 'src/engine/core-modules/file/file-url/file-url.service';
import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

type UploadCorePicture = {
  uploadCorePicture: (args: unknown) => Promise<FileEntity>;
};

describe('FileCorePictureService', () => {
  let service: FileCorePictureService;

  const workspaceRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const coreEntityCacheService = { invalidate: jest.fn() };
  const fileUrlService = {
    signFileByIdUrl: jest.fn().mockResolvedValue('https://signed/new-logo'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileCorePictureService,
        { provide: FileStorageService, useValue: {} },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: workspaceRepository,
        },
        { provide: getRepositoryToken(FileEntity), useValue: {} },
        { provide: FileUrlService, useValue: fileUrlService },
        { provide: SecureHttpClientService, useValue: {} },
        { provide: CoreEntityCacheService, useValue: coreEntityCacheService },
      ],
    }).compile();

    service = module.get(FileCorePictureService);

    jest
      .spyOn(service as unknown as UploadCorePicture, 'uploadCorePicture')
      .mockResolvedValue({ id: 'new-logo' } as FileEntity);
    jest.spyOn(service, 'deleteCorePicture').mockResolvedValue(undefined);
  });

  describe('uploadWorkspacePicture', () => {
    it('should invalidate the cached workspace and delete the stored previous logo when the caller holds a stale workspace', async () => {
      workspaceRepository.findOne.mockResolvedValue({
        id: 'workspace-id',
        logoFileId: 'stored-logo',
      });

      await service.uploadWorkspacePicture({
        file: Buffer.from(''),
        filename: 'logo.png',
        workspace: {
          id: 'workspace-id',
          logoFileId: 'stale-cached-logo',
        } as WorkspaceEntity,
      });

      expect(workspaceRepository.update).toHaveBeenCalledWith('workspace-id', {
        logoFileId: 'new-logo',
      });
      expect(coreEntityCacheService.invalidate).toHaveBeenCalledWith(
        'workspaceEntity',
        'workspace-id',
      );
      expect(service.deleteCorePicture).toHaveBeenCalledWith({
        fileId: 'stored-logo',
        workspaceId: 'workspace-id',
      });
    });

    it('should not delete anything when the workspace had no logo', async () => {
      workspaceRepository.findOne.mockResolvedValue({
        id: 'workspace-id',
        logoFileId: null,
      });

      await service.uploadWorkspacePicture({
        file: Buffer.from(''),
        filename: 'logo.png',
        workspace: { id: 'workspace-id', logoFileId: null } as WorkspaceEntity,
      });

      expect(coreEntityCacheService.invalidate).toHaveBeenCalled();
      expect(service.deleteCorePicture).not.toHaveBeenCalled();
    });
  });
});
