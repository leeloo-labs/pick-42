'use strict';

// Streams a picked File as lines for the 17Lands dataset extractor, inflating
// .gz exports through the browser's native DecompressionStream. Each openLines
// call starts a fresh read, matching the extractor's two-pass contract.
function fileLineSource(file) {
  return {
    openLines() {
      return {
        async *[Symbol.asyncIterator]() {
          let stream = file.stream();
          if (/\.gz$/i.test(file.name)) stream = stream.pipeThrough(new DecompressionStream('gzip'));
          const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
          let buffered = '';
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              const parts = (buffered + value).split('\n');
              buffered = parts.pop();
              for (const part of parts) yield part.endsWith('\r') ? part.slice(0, -1) : part;
            }
            if (buffered) yield buffered.endsWith('\r') ? buffered.slice(0, -1) : buffered;
          } finally {
            await reader.cancel().catch(() => {});
          }
        }
      };
    }
  };
}

module.exports = { fileLineSource };
