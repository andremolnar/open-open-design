# Container installer (inherited)

The scripts under `deploy/` were inherited from the original OpenDesign project. Their default container image is **upstream**, not a build of this independent fork. There is no published one-click installer or supported container image for this fork.

To run this fork, follow the [source quickstart](../README.md#start-without-an-opendesign-account). For Docker or Compose, build and identify your own image, then set `OPEN_DESIGN_IMAGE` explicitly before following the inherited [container guide](../deploy/README.md). Do not assume an upstream image contains this fork's sign-in, telemetry, or MCP changes.

This fork is maintained by [Andre Molnar](../MAINTAINERS.md). Upstream installer schedules and release promises do not apply here.
