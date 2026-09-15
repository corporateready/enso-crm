import { In, QueryFailedError } from 'typeorm';

import { POSTGRESQL_ERROR_CODES } from 'src/engine/api/graphql/workspace-query-runner/constants/postgres-error-codes.constants';

// Re-points the duplicates' foreign keys at the keeper, for BOTH the person and
// company merge executors.
//
// The two failure modes are not equivalent and must not be treated alike:
//
//   - a unique-constraint clash means the keeper ALREADY carries an equivalent
//     row (two opportunities for the same person x company, say). The
//     duplicate's copy is redundant, nothing is lost by leaving it behind, and
//     the merge should finish. Retrying would clash forever, so aborting here
//     would mean those duplicates could never merge at all.
//
//   - anything else — the object is unreachable, the write is rejected — means
//     we cannot say what would be stranded. The caller must abandon the merge
//     rather than soft-delete the record those rows still point at.

export type ReassignmentTarget = { object: string; field: string };

// Only the two methods this utility calls, so the dynamic workspace repository
// does not have to be widened to `any` here.
type ReassignableRepository = {
  find: (options: object) => Promise<{ id: string }[]>;
  update: (criteria: object, partial: object) => Promise<unknown>;
};

export type ReassignmentOutcome = {
  // Non-empty means: do not delete anything.
  blockingFailures: string[];
  // Rows the keeper already had an equivalent of, left on the duplicate.
  redundantRowCount: number;
};

type ReassignRelationsArgs = {
  targets: ReassignmentTarget[];
  duplicateIds: string[];
  keeperId: string;
  actor: unknown;
  getRepository: (object: string) => Promise<ReassignableRepository>;
};

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error as QueryFailedError & { code?: string }).code ===
    POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION;

export const reassignRelations = async ({
  targets,
  duplicateIds,
  keeperId,
  actor,
  getRepository,
}: ReassignRelationsArgs): Promise<ReassignmentOutcome> => {
  const blockingFailures: string[] = [];
  let redundantRowCount = 0;

  for (const { object, field } of targets) {
    let repository: ReassignableRepository;

    try {
      repository = await getRepository(object);
    } catch (error) {
      blockingFailures.push(
        `${object}.${field} (unreachable: ${(error as Error).message})`,
      );
      continue;
    }

    try {
      await repository.update(
        { [field]: In(duplicateIds) },
        { [field]: keeperId, updatedBy: actor },
      );
      continue;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        blockingFailures.push(
          `${object}.${field}: ${(error as Error).message}`,
        );
        continue;
      }
    }

    // The bulk update is a single statement, so one clashing row also blocks
    // every row that would have moved cleanly. Re-point them individually so
    // only the genuinely redundant ones are left behind.
    let rows: { id: string }[];

    try {
      rows = await repository.find({ where: { [field]: In(duplicateIds) } });
    } catch (error) {
      blockingFailures.push(
        `${object}.${field} (could not list clashing rows: ${
          (error as Error).message
        })`,
      );
      continue;
    }

    for (const row of rows) {
      try {
        await repository.update(
          { id: row.id },
          { [field]: keeperId, updatedBy: actor },
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          redundantRowCount += 1;
          continue;
        }

        blockingFailures.push(
          `${object}.${field} row ${row.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  return { blockingFailures, redundantRowCount };
};
