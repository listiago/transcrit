const fs = require('node:fs');
const path = require('node:path');

// Local, bounded operational data only. Never accepts text, audio or credentials.
class Diagnostics {
  constructor(directory) { this.file = path.join(directory, 'diagnostics.jsonl'); }
  write(event, details = {}) {
    if (!/^[a-z_-]{1,50}$/.test(event)) return;
    const record = { at: new Date().toISOString(), event };
    for (const key of ['code', 'phase', 'operation']) {
      const value = details[key];
      if (typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_-]{0,49}$/.test(value)) record[key] = value;
    }
    if (Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599) record.httpStatus = details.httpStatus;
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size >= 65536) fs.writeFileSync(this.file, '');
      fs.appendFileSync(this.file, JSON.stringify(record) + '\n', 'utf8');
    } catch { /* Diagnostics must never interrupt a dictation. */ }
  }
}
module.exports = { Diagnostics };
