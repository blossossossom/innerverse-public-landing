// Vercel serverless function — POST /api/subscribe
// Adds an email to the MailerLite group specified in MAILERLITE_GROUP_ID.
// Uses MailerLite API v3 (connect.mailerlite.com).
//
// Logic:
//   1. GET subscriber to check current status + group membership.
//   2. If already ACTIVE in our group → return existing:true (already on waitlist).
//   3. If subscriber exists but is unsubscribed/inactive:
//        a. DELETE them from the group (resets the "joins group" trigger).
//        b. POST to re-add them → fires the "subscriber joins group" automation fresh.
//   4. If subscriber doesn't exist at all → POST to create → fires automation normally.

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
    // ── Step 1: check if subscriber exists ───────────────────────────────
    const checkRes  = await fetch(
      `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(cleanEmail)}`,
      { headers }
    );

    if (checkRes.ok) {
      const checkData    = await checkRes.json();
      const status       = checkData?.data?.status;
      const subscriberId = checkData?.data?.id;
      const groupIds     = (checkData?.data?.groups || []).map(g => String(g.id));
      const inOurGroup   = groupIds.includes(String(GROUP_ID));

      console.log(`Existing subscriber | status=${status} | inGroup=${inOurGroup} | id=${subscriberId}`);

      // Already active on the waitlist — nothing to do
      if (status === 'active' && inOurGroup) {
        return res.status(200).json({ success: true, existing: true });
      }

      // Subscriber exists but unsubscribed/inactive.
      // Delete them from the group first so the next POST fires a genuine
      // "subscriber joins group" event and triggers the welcome automation.
      if (inOurGroup && subscriberId) {
        const delRes = await fetch(
          `https://connect.mailerlite.com/api/subscribers/${subscriberId}/groups/${GROUP_ID}`,
          { method: 'DELETE', headers }
        );
        console.log(`Removed from group | HTTP ${delRes.status}`);
      }
    }
    // 404 = never existed → fall straight through to POST

    // ── Step 2: (re-)add to group — fires "subscriber joins group" automation
    const mlRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email:       cleanEmail,
        groups:      [GROUP_ID],
        status:      'active',
        resubscribe: true,
      }),
    });

    const mlData = await mlRes.json();

    if (!mlRes.ok) {
      const msg = mlData?.message || mlData?.error?.message || `MailerLite error ${mlRes.status}`;
      console.error('MailerLite rejected:', msg);
      return res.status(mlRes.status).json({ error: msg });
    }

    console.log(`Subscribed | HTTP ${mlRes.status} | status=${mlData?.data?.status} | groups=${JSON.stringify(mlData?.data?.groups?.map(g => g.id))}`);
    return res.status(200).json({ success: true, existing: false });

  } catch (err) {
    console.error('Unhandled error in /api/subscribe:', err);
    return res.status(500).json({ error: 'Server error — please try again.' });
  }
};
