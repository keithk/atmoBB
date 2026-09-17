/** A build that can't go on. The message is written for the extension's author and reads on its own. */
export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}
