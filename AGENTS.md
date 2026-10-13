<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- All Google Maps data calls (Places, Routes, Roads snap) go through authenticated server functions in src/lib/maps.functions.ts — keeps the server key private and usage bounded to signed-in users.
- Recorded GPS trips are snapped to roads with the Roads API before saving to delivery_routes — the saved line must follow real streets.
