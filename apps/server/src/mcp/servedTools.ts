/**
 * The names of the tools this server's own tool server has registered: T3 Code's, Majordome's and
 * the connected apps'. An adapter that lets the server's own calls run unasked checks a name
 * here, so a tool added later, or an app connected while the server runs, needs no second list.
 */

let registered: () => ReadonlyArray<string> = () => [];

export const serveToolNamesFrom = (source: () => ReadonlyArray<string>): void => {
  registered = source;
};

export const isServedTool = (name: string): boolean => registered().includes(name);
