// Keep this contract synchronized with mvp_tokenization/normalize.py.
const APOSTROPHES = new Set(["'", "’", "ʼ", "᾽", "′", "΄"]);
const LATIN_LANGS = new Set(["la", "lat"]);
const MARK = /\p{M}/u;

function fold(text, lang, stripMarks) {
  let out = "";
  for (const ch of String(text || "").normalize("NFD")) {
    if (APOSTROPHES.has(ch)) out += "'";
    else if (MARK.test(ch)) {
      if (stripMarks) continue;
      if (ch === "̀") out += "́";
      else if (ch === "̃") out += "͂";
      else out += ch;
    } else out += ch;
  }
  let folded = out.toLowerCase().replaceAll("ς", "σ");
  if (LATIN_LANGS.has(lang)) folded = folded.replaceAll("j", "i").replaceAll("v", "u");
  return folded.normalize("NFC");
}

export const matchKey = (text, lang) => fold(text, lang, LATIN_LANGS.has(lang));
export const looseKey = (text, lang) => fold(text, lang, true);
