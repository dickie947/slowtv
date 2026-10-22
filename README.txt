SLOWTV
======

A slow, deliberate way to watch a short list of YouTube channels. Early-portal look, one week at a time, no autoplay, no "up next", no recommendations, and a daily viewing limit.

It is a static web page plus a small job that runs once a day to fetch each channel's latest uploads. It works on iPhone, iPad and laptop through the same web address.


WHAT IS IN THIS FOLDER
----------------------

index.html
    The whole website (TV Guide, channel pages, player, settings).

channels.json
    Your channel list. Edit this to add or remove channels.

scripts/refresh.mjs
    Fetches the latest uploads for each channel.

data/feed.json
    The fetched programme list (written by the refresh job).

data/state.json
    Remembers channel IDs and skipped Shorts (written by the refresh job).

.github/workflows/refresh.yml
    Tells GitHub to refresh daily and publish the site.

setup/refresh.yml.txt
    A visible copy of the file above, in case your computer hides folders that start with a dot.

manifest.webmanifest and the .png files
    Icons and "Add to Home Screen" support.


PUT IT ONLINE WITH GITHUB PAGES (about 10 minutes, free)
--------------------------------------------------------

You need a free GitHub account. Everything below is done in the browser; no software to install.

1. CREATE A REPOSITORY
   On github.com click the + (top right), then "New repository". Name it slowtv. Choose Public (GitHub Pages is free for public repositories only; the repository holds nothing private, just your channel list). Tick nothing else, then click "Create repository".

2. TURN ON PAGES FIRST
   In the new repository go to Settings, then Pages (left side). Under "Build and deployment", set Source to "GitHub Actions".

3. UPLOAD THE FILES
   Back on the Code tab click "Add file", then "Upload files". Unzip the folder on your computer and drag in everything INSIDE it (not the folder itself): index.html, channels.json, manifest.webmanifest, the .png files, and the scripts, data and setup folders. Click "Commit changes".

4. ADD THE WORKFLOW FILE
   Computers often hide folders that start with a dot, so do this one by typing instead of dragging. Click "Add file", then "Create new file". In the name box type exactly:
       .github/workflows/refresh.yml
   (typing the slashes creates the folders). Open setup/refresh.yml.txt from the unzipped folder, copy everything in it, paste it into the big box, and click "Commit changes". If your upload in step 3 already included a .github folder, skip this step.

5. RUN IT FOR THE FIRST TIME
   Click the Actions tab. Choose "Refresh and deploy" on the left, then "Run workflow", then the green "Run workflow" button. Wait two or three minutes until it shows a green tick. (Committing the workflow in step 4 may already have started a run. If so, just wait for it.)

6. OPEN YOUR SITE
   It lives at:
       https://YOUR-GITHUB-USERNAME.github.io/slowtv/
   The first run also lists the address in the finished "deploy" step.

7. ON IPHONE AND IPAD
   Open the address in Safari, tap Share, then "Add to Home Screen". Do the same on the other device. The home-screen icon and Safari keep separate saved data, so pick one and stick to it on each device.

From then on it refreshes itself every day at about 05:23 UTC and republishes. You can also press "Run workflow" any time to refresh on demand.


CHANGING YOUR CHANNELS
----------------------

Open channels.json on GitHub, click the pencil icon, edit, and commit. The site rebuilds within a few minutes. Each entry looks like this:

    { "handle": "NASA", "name": "NASA", "group": "Space" }

handle  = the part after the @ in the channel's YouTube address.
name    = what the guide displays.
group   = the heading in the Channels directory.

If a handle ever fails to resolve, add the channel's ID to that entry:  "id": "UC..."


HOW THE VIEWING LIMIT WORKS
---------------------------

- The limit counts time actually spent playing, not time the page is open. Pausing, buffering or a sleeping phone costs nothing.
- Lowering the limit takes effect immediately. Raising it only takes effect from tomorrow.
- The day rolls over at 04:00 local time.
- At the limit the player is removed and the programme page shows an OFF AIR card. The TV Guide stays browsable.
- The limit is friction, not a lock. It is stored on each device, so clearing the browser's data resets it.
- EACH DEVICE KEEPS ITS OWN COUNT. Two hours on the iPhone and two on the laptop is four. To share one count across devices you need a small server to hold it. That is a possible later upgrade. For now, Settings has a transfer code that merges watched marks and today's total between devices.


WHAT CANNOT BE CONTROLLED
-------------------------

The video comes from YouTube's own embedded player, so ads still play and YouTube's own controls apply. SlowTV can hide the things around the player, not everything inside it.

- Pausing normally makes YouTube show a "More videos" strip. SlowTV covers the bottom of the player with its own pause bar. In full-screen on a phone, YouTube's overlay can still appear when you pause.
- The video's own end cards (the last 5 to 20 seconds) are part of the video. Settings has an option to end programmes 15 seconds early to skip them.
- A few videos block embedding. SlowTV says so and offers an "Open on YouTube" link, which leaves the portal.
- The title bar at the top of the playing video links to YouTube.


IF SOMETHING GOES WRONG
-----------------------

THE GUIDE IS EMPTY OR OLD
    Open the Actions tab and look at the latest run of "Refresh and deploy", then click "Fetch the latest uploads" to read the log. If that step shows a red cross, YouTube refused the fetch, but the site is still published (on purpose, so you always have a page to look at). Lines beginning with ! name the channels that failed.

ONE CHANNEL IS MISSING
    In the run log look for a line beginning with ! followed by its handle. Add "id": "UC..." for it in channels.json.

"GET PAGES SITE FAILED" IN THE LOG
    Pages isn't switched on. Do step 2 and run the workflow again.

THE COMMIT STEP FAILS WITH A PERMISSIONS ERROR
    Go to Settings, Actions, General, Workflow permissions, choose "Read and write permissions", save, and run the workflow again.

DAILY REFRESH STOPS AFTER A LONG QUIET SPELL
    GitHub pauses scheduled jobs in repositories with no activity for 60 days. Open the Actions tab and press "Run workflow" to wake it.

VIDEO WON'T PLAY AND SHOWS AN ERROR
    Make sure you open the github.io address, not the file on your disk; YouTube's player refuses pages that don't identify themselves. If it still fails, in index.html change PLAYER_HOST near the top of the script to https://www.youtube.com

RUNNING TIMES ARE MISSING
    The refresh job reads them from YouTube's watch pages, which YouTube sometimes refuses to give to GitHub's servers. The guide still works; it just leaves out the "(38m)" part until a later run succeeds.
