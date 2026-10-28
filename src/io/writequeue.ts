/**
 * Runs jobs one after another, in the order they were asked for.
 *
 * Writing to the file is slow and asynchronous, and an autosave, a Save and
 * another autosave can all be waiting at once. Two writes to the same file at the
 * same time can land in either order, and the older one winning is how a file
 * ends up behind the screen. A job that fails does not stop the ones behind it,
 * and its error goes to whoever asked for it.
 */
export function createWriteQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}
