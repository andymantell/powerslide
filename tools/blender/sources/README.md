# Model sources

Third-party models that `tools/blender` builds from. They're not in the repo:
their authors ask that the models aren't passed on as standalone files, so
download them into the folders below before rebuilding. The built game files
are committed, so you only need these to change a model. Each pack is
recorded in `credits.json`.

## designersoup-car-pack-1/

[Low Poly Car Pack Volume 1](https://designersoup.itch.io/low-poly-car-pack-1)
by Designersoup. The itch.io page gives the licence as CC0 1.0. Its usage
terms also say "You may not resell, redistribute, or repackage the models or
textures (modified or unmodified) as standalone assets or as part of another
asset pack", so the files stay out of git.

From the zip, copy `Beatall.fbx`, `Landyroamer.fbx`, `Toyoyo Highlight.fbx`
and `Tristar Racer.fbx`, plus the palette texture from any `.fbm` folder,
renamed to `gradient.png`. Then run `python tools/blender/vehicles.py`.
