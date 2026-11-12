"""Download one Facebook posting window's posts so they can be posted from Chrome.

    python3 -I scripts/fb_prepare.py 2026-11-13 p1 /path/to/outdir

Writes, in posting order, each group's text (<g>.txt), photos (<g>_<n>.jpg) or
the intro video, and manifest.json listing the files to upload per group.
Photos for one post must total under 9.5 MB (Chrome upload limit): photos
without an AI-generated tag are shrunk first, so AI tags stay on the post.
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.request

BOT = "https://reseller-wa-comm-production-a4a7.up.railway.app"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMIT = 9_500_000


def has_ai_tag(path):
    with open(path, "rb") as f:
        data = f.read()
    return b"c2pa" in data.lower() or b"trainedAlgorithmicMedia" in data


def shrink(src):
    dst = src.replace(".jpg", "s.jpg")
    subprocess.run(["sips", "-s", "format", "jpeg", "-Z", "1400", "-s", "formatOptions", "80", src, "--out", dst],
                   check=True, capture_output=True)
    return dst


def fit(paths):
    """Return paths to upload, shrinking until the total fits."""
    files = list(paths)
    total = lambda: sum(os.path.getsize(p) for p in files)
    # Biggest untagged photos first, then tagged ones only if still too big
    for tagged in (False, True):
        for i in sorted(range(len(files)), key=lambda i: -os.path.getsize(files[i])):
            if total() <= LIMIT:
                return files, tagged
            if has_ai_tag(files[i]) == tagged:
                files[i] = shrink(files[i])
    return files, True


def main(date, slot, out):
    os.makedirs(out, exist_ok=True)
    with urllib.request.urlopen(f"{BOT}/fb/plan/slot?date={date}&slot={slot}", timeout=900) as r:
        plan = json.load(r)
    if "posts" not in plan:
        sys.exit(f"Plan error: {plan}")

    manifest = []
    for post in plan["posts"]:
        g = post["g"]
        with open(os.path.join(out, f"{g}.txt"), "w") as f:
            f.write(post["text"])
        if post["kind"] == "intro":
            video = os.path.join(out, "intro.mp4")
            if not os.path.exists(video):
                shutil.copy(os.path.join(REPO, "assets", "intro.mp4"), video)
            files, ai_lost = [video], False
        else:
            photos = []
            for n, url in enumerate(post["photos"], 1):
                p = os.path.join(out, f"{g}_{n}.jpg")
                urllib.request.urlretrieve(url, p)
                photos.append(p)
            files, ai_lost = fit(photos)
        manifest.append({
            "g": g, "group": post["group"], "groupId": post["groupId"], "time": post["time"],
            "kind": post["kind"], "topic": post.get("topic"), "files": files,
            "ai_tag_shrunk": ai_lost, "text_json": json.dumps(post["text"]),
        })

    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"{date} {slot}: {len(manifest)} posts -> {out}/manifest.json")
    for m in manifest:
        print(f"  {m['time']}  {m['g']:4}  {m['kind']:5}  {m['topic'] or ''}  ({len(m['files'])} files)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
