import { Injectable, Logger } from '@nestjs/common';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { ENSO_USER_COLUMN_WIDTHS_KEY } from 'src/modules/enso/column-widths/constants/enso-column-widths.constants';
import {
  type EnsoUserColumnWidths,
  mergeEnsoUserColumnWidth,
  readEnsoUserColumnWidths,
} from 'src/modules/enso/column-widths/utils/enso-column-widths.util';

// How wide each table column is FOR ONE PERSON, per view. See the constants
// file for why this is personal rather than a property of the view.
@Injectable()
export class EnsoColumnWidthsService {
  private readonly logger = new Logger(EnsoColumnWidthsService.name);

  constructor(private readonly keyValuePairService: KeyValuePairService) {}

  async getUserColumnWidths({
    workspaceId,
    userId,
  }: {
    workspaceId: string;
    userId: string;
  }): Promise<EnsoUserColumnWidths> {
    const rows = await this.keyValuePairService.get({
      type: KeyValuePairType.USER_VARIABLE,
      userId,
      workspaceId,
      key: ENSO_USER_COLUMN_WIDTHS_KEY,
    });

    return readEnsoUserColumnWidths(rows?.[0]?.value);
  }

  // Read-modify-write on one row: a person resizes one column at a time from
  // one tab, so the last write winning is the behaviour they expect.
  async setUserColumnWidth({
    workspaceId,
    userId,
    viewId,
    fieldMetadataId,
    size,
  }: {
    workspaceId: string;
    userId: string;
    viewId: string;
    fieldMetadataId: string;
    size: number | null;
  }): Promise<EnsoUserColumnWidths> {
    const currentWidths = await this.getUserColumnWidths({
      workspaceId,
      userId,
    });

    const nextWidths = mergeEnsoUserColumnWidth({
      widths: currentWidths,
      viewId,
      fieldMetadataId,
      size,
    });

    await this.keyValuePairService.set({
      userId,
      workspaceId,
      key: ENSO_USER_COLUMN_WIDTHS_KEY,
      value: nextWidths,
      type: KeyValuePairType.USER_VARIABLE,
    });

    this.logger.log(
      `user ${userId} column width for field ${fieldMetadataId} on view ${viewId} set to ${size ?? 'the view default'}`,
    );

    return nextWidths;
  }
}
