# Top 25 Lenses

Ranked from `docs/PHASE12_AUDIT_lens-classification.csv` (the source-of-truth
depth audit covering all 236 lens directories).

## Scoring

```
score = (page_loc + domain_loc) + (macros + lens_actions + routes) * 50
```

LOC counts the surface area of the lens page and its backing domain file;
integration points (macros, `registerLensAction` handlers, dedicated routes)
are weighted at 50 LOC equivalent so a small but heavily wired lens isn't
penalised against a thick UI with shallow backend coupling. All 25 entries
below land in the audit's **DEEP** tier (substantial UI + real backend).

## Ranking

| #  | Lens          | Tier | Score | Page LOC | Domain LOC | Macros | Actions | Routes |
|----|---------------|------|------:|---------:|-----------:|-------:|--------:|-------:|
|  1 | world         | DEEP |  8507 |     6026 |        531 |      0 |      18 |     21 |
|  2 | chat          | DEEP |  6291 |     4231 |        760 |      0 |      20 |      6 |
|  3 | education     | DEEP |  6092 |     4635 |        757 |      0 |      14 |      0 |
|  4 | healthcare    | DEEP |  5641 |     4020 |        721 |      0 |      18 |      0 |
|  5 | accounting    | DEEP |  5460 |     3100 |       1210 |      0 |      23 |      0 |
|  6 | food          | DEEP |  4855 |     2851 |        954 |      0 |      21 |      0 |
|  7 | legal         | DEEP |  4636 |     3414 |        322 |      0 |      12 |      6 |
|  8 | government    | DEEP |  4392 |     3579 |        313 |      0 |      10 |      0 |
|  9 | realestate    | DEEP |  4389 |     3398 |        391 |      0 |      12 |      0 |
| 10 | code          | DEEP |  4319 |     2601 |        868 |      0 |      14 |      3 |
| 11 | environment   | DEEP |  4290 |     3745 |        195 |      0 |       7 |      0 |
| 12 | logistics     | DEEP |  4055 |     2787 |        718 |      0 |      11 |      0 |
| 13 | trades        | DEEP |  3951 |     2530 |        621 |      0 |      16 |      0 |
| 14 | finance       | DEEP |  3868 |     2432 |        586 |      0 |      17 |      0 |
| 15 | studio        | DEEP |  3794 |     2706 |        288 |      0 |      13 |      3 |
| 16 | council       | DEEP |  3745 |     3485 |         60 |      0 |       4 |      0 |
| 17 | agriculture   | DEEP |  3741 |     1982 |        859 |      0 |      18 |      0 |
| 18 | aviation      | DEEP |  3732 |     2124 |        708 |      0 |      18 |      0 |
| 19 | retail        | DEEP |  3472 |     2043 |        679 |      0 |      15 |      0 |
| 20 | science       | DEEP |  3441 |     2217 |        524 |      0 |      14 |      0 |
| 21 | marketplace   | DEEP |  3352 |     2926 |         76 |      0 |       4 |      3 |
| 22 | admin         | DEEP |  3319 |     2683 |        486 |      0 |       3 |      0 |
| 23 | crypto        | DEEP |  3284 |     1651 |        783 |      0 |      17 |      0 |
| 24 | manufacturing | DEEP |  3253 |     2745 |        158 |      0 |       7 |      0 |
| 25 | whiteboard    | DEEP |  3234 |     1719 |        465 |      0 |      21 |      0 |

## Observations

- **`world` is the outlier** by a wide margin — 6026 LOC of page code plus 21
  dedicated routes reflect Concordia's 3D civilization simulator layered
  inside the lens shell (terrain, avatars, combat, NPC dialogue, quests).
- **No top-25 lens uses the macro pattern** (`macros = 0` across the board);
  all backend integration goes through the older `registerLensAction` path.
  The macro registry is dense elsewhere — see `docs/AUDIT_INVENTORY.md`'s
  ~826 `(domain, macro)` pairs — but the heaviest lenses predate that
  pattern.
- **`accounting`** has the deepest domain file (1210 LOC) and most lens
  actions (23) of any lens, edging out `food` (954/21) and `whiteboard`
  (465/21).
- **`council`** punches in at #16 on page LOC (3485) despite a tiny domain
  (60 LOC), reflecting governance UI weight versus thin server logic.
- **Rival-shape mounts** are well represented: `code` (VSCodeShell),
  `accounting` (KPIStrip), `legal` (DocsShell), `whiteboard`
  (WhiteboardCanvas), `crypto` (WalletShell), `healthcare` (EHRShell),
  `marketplace` (BandcampGrid). See CLAUDE.md "236-lens frontend" for the
  full silhouette inventory.

## Reproducing

```bash
awk -F',' 'NR>1 { score = ($2+$3) + ($4+$5+$7)*50; print score"|"$0 }' \
  docs/PHASE12_AUDIT_lens-classification.csv \
  | sort -rn | head -25
```
