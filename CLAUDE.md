# Project rules

## Fixtures must be generic

`conversation.html` (and any other fixture or test sample) must never contain real conversation content: no real names, employers, projects, tech stacks, infrastructure choices, metrics, or personal details, and no light paraphrase of them.

- Use neutral placeholders (`MockAlpha`, `Tech-A`, `Decision One`, "X%") in mixed Hebrew/English sentences.
- Keep the DOM structure identical when sanitizing; replace text nodes only, then confirm the tag sequence is unchanged.
- When adding a fixture captured from a real page, sanitize it before committing.

## README

Do not hardcode the script version in `README.md`; use the generic `v1.x`. No README update is needed on version bumps.
