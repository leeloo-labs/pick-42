'use strict';

/**
 * Extracts balanced JSON documents from Arena's mixed text/JSON log stream.
 * Arena sometimes writes JSON over several lines and sometimes embeds escaped
 * JSON inside string fields, so line-by-line JSON.parse is not sufficient.
 */
class JsonEntryStream {
  constructor(onDocument) {
    this.onDocument = onDocument;
    this.buffer = '';
  }

  reset() {
    this.buffer = '';
  }

  push(chunk) {
    this.buffer += chunk.toString();
    this.#drain();
  }

  #drain() {
    let searchFrom = 0;

    while (searchFrom < this.buffer.length) {
      const start = this.buffer.indexOf('{', searchFrom);
      if (start === -1) {
        this.buffer = this.buffer.slice(-4096);
        return;
      }

      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;

      for (let index = start; index < this.buffer.length; index += 1) {
        const character = this.buffer[index];

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === '\\') {
            escaped = true;
          } else if (character === '"') {
            inString = false;
          }
          continue;
        }

        if (character === '"') {
          inString = true;
        } else if (character === '{') {
          depth += 1;
        } else if (character === '}') {
          depth -= 1;
          if (depth === 0) {
            end = index;
            break;
          }
        }
      }

      if (end === -1) {
        this.buffer = this.buffer.slice(start);
        return;
      }

      const candidate = this.buffer.slice(start, end + 1);
      try {
        this.onDocument(JSON.parse(candidate));
        this.buffer = this.buffer.slice(end + 1);
        searchFrom = 0;
      } catch {
        searchFrom = start + 1;
      }
    }
  }
}

module.exports = { JsonEntryStream };
