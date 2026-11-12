# Facebook group posting runbook

How one posting window is posted from Chrome (Claude in Chrome) as the
personal profile **Ansuk Samal**. A scheduled run follows this once per window.

Windows (IST):
- 13 Nov 2026 only: `intro` 09:00–10:30, `p1` 11:00–13:00, `p2` 16:00–18:00
- From 14 Nov 2026, daily: `p1` 10:00–12:00, `p2` 14:00–16:00, `p3` 17:00–19:00

## 1. Prepare

```
OUT=~/Claude/fb-runs/<date>_<slot>
python3 -I ~/Claude/reseller-WA-Comm/scripts/fb_prepare.py <date> <slot> $OUT
```

This builds the window's plan on the bot (first call can take a few minutes)
and downloads every post's text and media. `$OUT/manifest.json` lists the posts
in posting order: `g`, `groupId`, `files` (absolute paths), `text_json` (the post
text as a JSON string literal).

`$OUT/posted.txt` holds the codes already posted in this window. Skip any group
listed there, and append its code right after posting it. This keeps a re-run
from posting twice.

## 2. Post each group, in manifest order

1. Navigate to `https://www.facebook.com/groups/<groupId>/`.
2. Open the composer with JavaScript:
   ```js
   const el=[...document.querySelectorAll('[role=button]')].find(b=>/^(Write something|Sell Something)/.test(b.innerText.trim())); el ? (el.click(), el.innerText.trim().slice(0,30)) : 'none'
   ```
   If it says `Sell Something` (marketplace-only group) or `none` (not a member,
   membership pending), press Escape, skip the group and note why.
3. `find` "hidden file-input inside the Create post dialog (near Add to your post)"
   and `file_upload` **all** of the post's `files` in **one** call. A second upload
   replaces the first.
4. Paste the text (put the manifest's `text_json` value where shown, unchanged):
   ```js
   const t = <text_json>;
   const box = document.querySelector('div[role=dialog] div[contenteditable=true][role=textbox]'); box.focus(); const dt = new DataTransfer(); dt.setData('text/plain', t); box.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); 'pasted'
   ```
5. Check before posting:
   ```js
   const d=[...document.querySelectorAll('div[role=dialog]')].find(x=>x.querySelector('[contenteditable=true][role=textbox]')); const s=d.querySelector('[contenteditable=true][role=textbox]').innerText; const sw=d.querySelector('[role=switch]'); ({len:s.length, codes:[...new Set(s.match(/\.app\/(f\d+)\//g))], anon: sw?sw.getAttribute('aria-checked'):'none', video:d.querySelectorAll('video').length, imgs:[...d.querySelectorAll('img')].filter(i=>i.src.startsWith('blob:')).length, author: d.innerText.includes('Ansuk Samal')})
   ```
   Post only if: `len` > 500, `codes` is exactly this group's code, `anon` is
   `"false"` or `"none"`, `author` is true, and there is media (video ≥ 1 for
   intro, imgs ≥ 1 for products). Otherwise close the composer, skip and note it.
6. Post:
   ```js
   const d=[...document.querySelectorAll('div[role=dialog]')].find(x=>x.querySelector('[contenteditable=true][role=textbox]')); d.querySelector('div[aria-label="Post"][role=button]').click(); 'clicked'
   ```
   Wait 10 seconds, confirm the composer closed, then append the group code to
   `$OUT/posted.txt`.

## Rules

- Post only as Ansuk Samal. If the composer shows another name (e.g. the TLS
  Page), stop the run and report it. Do not switch profiles yourself.
- Never turn on "Post anonymously", never answer membership questions or agree to
  group rules, never join or leave groups, never comment or message anyone.
- If Facebook shows a warning, block, "You can't post right now", checkpoint or
  login page, stop the whole run immediately and report it — do not retry.
- Do not edit post text. If something looks wrong, skip that group and report.
- Close the Chrome tabs you opened when done.

## Report

End with: window, how many posted, and each skipped/failed group with the reason.
