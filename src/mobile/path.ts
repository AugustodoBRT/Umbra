export const extname = (value: string) => { const name = value.split('/').at(-1) ?? ''; const index = name.lastIndexOf('.'); return index > 0 ? name.slice(index) : ''; };
export const basename = (value: string,suffix = '') => { const name = value.split('/').at(-1) ?? ''; return suffix && name.endsWith(suffix) ? name.slice(0,-suffix.length) : name; };
export default { basename,extname };
