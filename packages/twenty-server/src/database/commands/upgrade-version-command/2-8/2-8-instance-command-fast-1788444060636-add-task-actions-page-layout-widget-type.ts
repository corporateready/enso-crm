import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

// WidgetType.TASK_ACTIONS was added to the TypeScript enum in #110, but the
// matching Postgres enum value was applied to production by hand and never
// committed — so every fresh database (CI included) lacks it. IF NOT EXISTS
// keeps this a no-op on the instances where it was already applied manually.
@RegisteredInstanceCommand('2.8.0', 1788444060636)
export class AddTaskActionsPageLayoutWidgetTypeFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "core"."pageLayoutWidget_type_enum" ADD VALUE IF NOT EXISTS 'TASK_ACTIONS' AFTER 'TASKS'`,
    );
  }

  // Postgres cannot drop an enum value, so reverting means rebuilding the type
  // without it (same shape as the 1-23 view_type_enum command).
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "core"."pageLayoutWidget_type_enum_old" AS ENUM('CALENDAR', 'EMAILS', 'EMAIL_THREAD', 'FIELD', 'FIELDS', 'FIELD_RICH_TEXT', 'FILES', 'FRONT_COMPONENT', 'GRAPH', 'IFRAME', 'NOTES', 'RECORD_TABLE', 'STANDALONE_RICH_TEXT', 'TASKS', 'TIMELINE', 'VIEW', 'WORKFLOW', 'WORKFLOW_RUN', 'WORKFLOW_VERSION')`,
    );
    await queryRunner.query(
      'ALTER TABLE "core"."pageLayoutWidget" ALTER COLUMN "type" DROP DEFAULT',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."pageLayoutWidget" ALTER COLUMN "type" TYPE "core"."pageLayoutWidget_type_enum_old" USING "type"::"text"::"core"."pageLayoutWidget_type_enum_old"',
    );
    await queryRunner.query(
      `ALTER TABLE "core"."pageLayoutWidget" ALTER COLUMN "type" SET DEFAULT 'VIEW'`,
    );
    await queryRunner.query('DROP TYPE "core"."pageLayoutWidget_type_enum"');
    await queryRunner.query(
      'ALTER TYPE "core"."pageLayoutWidget_type_enum_old" RENAME TO "pageLayoutWidget_type_enum"',
    );
  }
}
