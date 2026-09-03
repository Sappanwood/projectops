export type CliIO = {
  stdout(message: string): void;
  stderr(message: string): void;
  stdin?(): string;
};
