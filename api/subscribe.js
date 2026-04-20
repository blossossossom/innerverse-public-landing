// Vercel serverless function — POST /api/subscribe
// Adds an email to the MailerLite group specified in MAILERLITE_GROUP_ID.
// Uses MailerLite API v3 (connect.mailerlite.com).
//
// Logic:
//   1. GET the subscriber to check their current status.
//   2. If they are already ACTIVE in our group → return existing:true (already on waitlist).
//   3. If they don't exist, or are unsubscribed/bounced/junk → POST to (re-)subscribe them,
//      return existing:false so the frontend shows the normal "You're in" confirmation.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { email } = req.body || {};

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const API_KEY  = process.env.MAILERLITE_API_KEY;
  const GROUP_ID = process.env.MAILERLITE_GROUP_ID;

  if (!API_KEY || !GROUP_ID) {
    console.error('Missing MAILERLITE_API_KEY or MAILERLITE_GROUP_ID env vars');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const headers = {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  };

  try {
    // ── Step 1: check if subscriber already exists and is active ──────────
    const checkRes  = await fetch(
      `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(cleanEmail)}`,
      { headers }
    );

    if (checkRes.ok) {
      const checkData   = await checkRes.json();
      const status      = checkData?.data?.status;          // 'active' | 'unsubscribed' | 'unconfirmed' | 'bounced' | 'junk'
      const groupIds    = (checkData?.data?.groups || []).map(g => String(g.id));
      const inOurGroup  = groupIds.includes(String(GROUP_ID));

      console.log(`Existing subscriber | status=${status} | inGroup=${inOurGroup}`);

      if (status === 'active' && inOurGroup) {
        // Already on the waitlist and active — nothing to do
        return res.status(200).json({ success: true, existing: true });
      }
      // Otherwise: unsubscribed / not in group / bounced / junk → fall through to re-subscribe
    }
    // 404 = subscriber doesn't exist at all → fall through to create

    // ── Step 2: create or re-subscribe ───────────────────────────────────
    const mlRes  = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email:       cleanEmail,
        groups:      [GROUP_ID],
        status:      'active',
        resubscribe: true,   // re-trigger automations for returning subscribers
      }),
    });

    const mlData = await mlRes.json();

    if (!mlRes.ok) {
      const msg = mlData?.message || mlData?.error?.message || `MailerLite error ${mlRes.status}`;
      console.error('MailerLite rejected:', msg);
      return res.status(mlRes.status).json({ error: msg });
    }

    console.log(`MailerLite subscribed | HTTP ${mlRes.status} | status=${mlData?.data?.status} | groups=${JSON.stringify(mlData?.data?.groups?.map(g => g.id))}`);
    return res.status(200).json({ success: true, existing: false });

  } catch (err) {
    console.error('Unhandled error in /api/subscribe:', err);
    return res.status(500).json({ error: 'Server error — please try again.' });
  }
};
