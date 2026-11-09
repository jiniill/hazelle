// Risu's regex script, as its files and its getDatabase hold one: the import reads it back (engine/import/convert), the
// export and the plugin adapter write it. A script switched off in Risu has the type 'disabled' instead.
export const RISU_SCRIPT_TYPES = { input: 'editinput', output: 'editoutput', process: 'editprocess', display: 'editdisplay', translation: 'edittrans' } as const satisfies Record<Hazelle.Script['stage'], string>;

export const risuRegex = ({ name, find, replace, stage, flags }: Hazelle.Script) =>
  ({ comment: name, in: find, out: replace, type: RISU_SCRIPT_TYPES[stage], ableFlag: flags !== null, flag: flags ?? '' });
