export class SiteWriteLocks {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(siteId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(siteId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(siteId, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(siteId) === tail) {
        this.#tails.delete(siteId);
      }
    }
  }
}
