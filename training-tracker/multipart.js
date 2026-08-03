// ファイルアップロード(multipart/form-data)を外部ライブラリなしで最低限パースする
// 1ファイル + 少数のテキストフィールド程度の想定(バックアップ復元用)
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!boundaryMatch) {
      return resolve({ fields: {}, files: {} });
    }
    const boundary = '--' + (boundaryMatch[1] || boundaryMatch[2]).trim();
    const boundaryBuf = Buffer.from(boundary);
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 20 * 1024 * 1024) req.destroy();
    });

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fields = {};
        const files = {};

        let start = buffer.indexOf(boundaryBuf);
        while (start !== -1) {
          const next = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
          if (next === -1) break;
          let part = buffer.slice(start + boundaryBuf.length, next);
          if (part[0] === 13 && part[1] === 10) part = part.slice(2); // 先頭の\r\nを除去

          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            const headerStr = part.slice(0, headerEnd).toString('utf8');
            let body = part.slice(headerEnd + 4);
            if (body.slice(-2).toString('utf8') === '\r\n') body = body.slice(0, -2);

            const nameMatch = headerStr.match(/name="([^"]+)"/);
            const filenameMatch = headerStr.match(/filename="([^"]*)"/);
            if (nameMatch) {
              const fieldName = nameMatch[1];
              if (filenameMatch && filenameMatch[1]) {
                files[fieldName] = { filename: filenameMatch[1], content: body };
              } else {
                fields[fieldName] = body.toString('utf8');
              }
            }
          }
          start = next;
        }

        resolve({ fields, files });
      } catch (err) {
        reject(err);
      }
    });

    req.on('error', reject);
  });
}

module.exports = parseMultipart;
