import json, os, sys, urllib.request
M = "/workspace/models"
for repo in sys.argv[1:]:
    sib = json.load(urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}?blobs=true"))["siblings"]
    bad = []
    for s in sib:
        p = f"{M}/{repo}/{s['rfilename']}"
        if not os.path.exists(p) or (s.get("size") is not None and os.path.getsize(p) != s["size"]):
            bad.append(s["rfilename"])
    if bad:
        print("INCOMPLETE", repo, len(bad), bad[:4])
    else:
        open(f"{M}/{repo}/.concord_complete", "w").close()
        print("COMPLETE  ", repo, len(sib), "files, sizes verified")
