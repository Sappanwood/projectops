export type ApplicationErrorCode =
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_INVALID"
  | "PROJECT_NOT_FOUND"
  | "BACKLOG_STORE_NOT_FOUND"
  | "BACKLOG_STORE_INVALID"
  | "INVALID_STATUS"
  | "INVALID_ITEM_ID"
  | "ITEM_NOT_FOUND"
  | "ITEM_ID_MISMATCH"
  | "ITEM_INVALID"
  | "REVISION_MISMATCH";

export type ApplicationError = {
  code: ApplicationErrorCode;
  message: string;
};

export type ApplicationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApplicationError };

export function applicationSuccess<T>(data: T): ApplicationResult<T> {
  return { ok: true, data };
}

export function applicationFailure<T>(
  code: ApplicationErrorCode,
  message: string,
): ApplicationResult<T> {
  return { ok: false, error: { code, message } };
}
