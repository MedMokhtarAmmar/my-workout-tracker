const { google } = require('googleapis');

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
];

let db;

function init(database) {
  db = database;
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

// Exchanges the OAuth code for tokens, verifies the account matches
// OWNER_EMAIL, and persists the refresh token. Throws 'UNAUTHORIZED_ACCOUNT'
// if a different Google account tries to sign in.
async function handleCallback(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  const { data } = await oauth2.userinfo.get();
  const email = data.email;

  const ownerEmail = process.env.OWNER_EMAIL;
  if (ownerEmail && email.toLowerCase() !== ownerEmail.toLowerCase()) {
    const err = new Error('UNAUTHORIZED_ACCOUNT');
    err.code = 'UNAUTHORIZED_ACCOUNT';
    throw err;
  }

  // Google only sends a refresh_token on the first consent; keep the
  // existing one on subsequent logins.
  let refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    const existing = db.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').get();
    refreshToken = existing?.refresh_token;
  }
  if (!refreshToken) {
    const err = new Error('NO_REFRESH_TOKEN');
    err.code = 'NO_REFRESH_TOKEN';
    throw err;
  }

  db.prepare(`
    INSERT INTO google_auth (id, email, refresh_token, access_token, access_token_expiry)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      refresh_token = excluded.refresh_token,
      access_token = excluded.access_token,
      access_token_expiry = excluded.access_token_expiry
  `).run(email, refreshToken, tokens.access_token || null, tokens.expiry_date || null);

  return email;
}

function isConnected() {
  return !!db.prepare('SELECT id FROM google_auth WHERE id = 1').get();
}

function getConnectedEmail() {
  return db.prepare('SELECT email FROM google_auth WHERE id = 1').get()?.email || null;
}

function disconnect() {
  db.prepare('DELETE FROM google_auth WHERE id = 1').run();
}

function getAuthorizedClient() {
  const row = db.prepare('SELECT * FROM google_auth WHERE id = 1').get();
  if (!row) return null;

  const client = getOAuth2Client();
  client.setCredentials({
    refresh_token: row.refresh_token,
    access_token: row.access_token,
    expiry_date: row.access_token_expiry,
  });
  client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      db.prepare('UPDATE google_auth SET access_token = ?, access_token_expiry = ? WHERE id = 1')
        .run(tokens.access_token, tokens.expiry_date);
    }
  });
  return client;
}

function addHour(date, time) {
  const [h, m] = time.split(':').map(Number);
  if (h < 23) return { date, time: `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return { date: next.toISOString().slice(0, 10), time: `${String(h + 1 - 24).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

// Creates a Calendar event with a popup reminder for a workout. Returns the
// event id, or null if Google Calendar isn't connected.
async function createWorkoutEvent({ date, time, timeZone, title }) {
  const client = getAuthorizedClient();
  if (!client) return null;

  const end = addHour(date, time);
  const calendar = google.calendar({ version: 'v3', auth: client });
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      start: { dateTime: `${date}T${time}:00`, timeZone },
      end: { dateTime: `${end.date}T${end.time}:00`, timeZone },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
    },
  });
  return res.data.id;
}

async function deleteWorkoutEvent(eventId) {
  const client = getAuthorizedClient();
  if (!client) return;
  const calendar = google.calendar({ version: 'v3', auth: client });
  await calendar.events.delete({ calendarId: 'primary', eventId }).catch(() => {});
}

module.exports = {
  init,
  getAuthUrl,
  handleCallback,
  isConnected,
  getConnectedEmail,
  disconnect,
  createWorkoutEvent,
  deleteWorkoutEvent,
};
