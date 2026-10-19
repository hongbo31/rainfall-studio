# Delivery format fixture

This is a complete, schema-valid offline fixture. The 64x64 solid purple PNG is a local placeholder, not a dot-generated cover or publication material. Lyrics and prompts are explicit replacement placeholders. Nothing in this example proves dot's identity.

Copy the four payload files unchanged into `<inboxRoot>/deliveries/dot-delivery-format-20261018/`. README.md is explanatory only. For real creation, replace text.json and the image, choose new delivery/batch/item IDs as appropriate, then compute SHA256 over the exact final file bytes. Write manifest.json after the payload and READY.json last. A cloud service can expose READY early: the receiver still verifies every byte before committing.

The manifest hashes include UTF-8 file bytes and final LF newline. Reformatting JSON changes its hash. After changing manifest.json, recompute READY.manifestSha256. Do not reuse the fixture hashes for new creative content.

One cover is required for each text item and exact revision. Files must be named `cover-<lowercase sha256>.png|jpg|webp`. Only fully decoded still PNG/JPEG/WebP are supported, <=20MiB, <=10000 per axis, <=25 million pixels. New content for an accepted revision requires a new revision; repeated exact packages return the same receipt.

The local client must have a matching configured inbox channel: workspaceRef `rainfall-personal`, artistRef `creator`, seriesRef null. It imports a text candidate and cover asset with model evaluation pending. It creates no music-generation or publication task.

Google Drive Desktop is installed separately but not signed in. Actual sync path mapping, cloud-to-client receipt round trip, scheduling, packaging and formal-client upgrade are not completed by this fixture.
