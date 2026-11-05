const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en-GB,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' };
const page = await (await fetch('https://www.youtube.com/@PhilMcKinney', { headers: H })).text();
const cid = (page.match(/"externalId":"(UC[\w-]{22})"/) || page.match(/"channelId":"(UC[\w-]{22})"/))[1];
const x = await (await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + cid, { headers: H })).text();
for (const m of x.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)[\s\S]*?<title>([^<]*)[\s\S]*?<published>([^<]+)/g)) console.log(m[3], m[1], m[2].slice(0, 60));
