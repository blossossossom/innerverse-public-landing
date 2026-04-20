// Vercel serverless function — POST /api/subscribe
// Adds an email to the MailerLite group specified in MAILERLITE_GROUP_ID.
// Uses MailerLite API v3 (connect.mailerlite.com).

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { email } = req.body || {};

  // Basic validation
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const API_KEY  = process.env.MAILERLITE_API_KEY;
  const GROUP_ID = process.env.MAILERLITE_GROUP_ID;

  if (!API_KEY || !GROUP_ID) {
    console.error('Missing MAILERLITE_API_KEY or MAILERLITE_GROUP_ID env vars');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  try {
    const mlRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        email:       email.toLowerCase().trim(),
        groups:      [GROUP_ID],
        resubscribe: true,   // re-trigger automations for returning/lapsed subscribers
        status:      'active',
      }),
    });

    const mlData = await mlRes.json();

    if (!mlRes.ok) {
      const msg =
        mlData?.message ||
        mlData?.error?.message ||
        `MailerLite error ${mlRes.status}`;
      console.error('MailerLite rejected:', msg, mlData);
      return res.status(mlRes.status).json({ error: msg });
    }

    // 201 = newly created subscriber, 200 = subscriber already existed
    const isNew = mlRes.status === 201;
    console.log(`MailerLite HTTP ${mlRes.status} | status=${mlData?.data?.status} | groups=${JSON.stringify(mlData?.data?.groups?.map(g=>({id:g.id,name:g.name})))} | subscribed_at=${mlData?.data?.subscribed_at}`);
    return res.status(200).json({ success: true, existing: !isNew });
  } catch (err) {
    console.error('Unhandled error in /api/subscribe:', err);
    return res.status(500).json({ error: 'Server error — please try again.' });
  }
};
