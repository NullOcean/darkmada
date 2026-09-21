# Building a personal Armada image and updating an Odin 3

This guide describes the recommended development loop for a personal Armada
fork. It keeps the installed Odin on bootc's atomic update path, preserves the
previous deployment for rollback, and avoids reflashing internal storage for
each change.

Commands containing `<odin-ip>`, `<run-id>`, or `sha256:<digest>` are
templates. Replace every placeholder before running them.

## Recommended model

Use three pieces:

1. The Git repository is the source of truth.
2. GitHub Actions builds and signs `ghcr.io/andrewmccament/darkmada:odin` on a
   native ARM runner.
3. The Odin uses `bootc switch` once to adopt that image. Later builds on the
   same tag can be installed with `bootc upgrade` or Armada's update UI.

A flashable disk image is useful for a clean installation, a rescue SD card,
or recovery from damaged internal storage. It is not needed for an ordinary
code update.

The installed system and `/var/home/armada` are separate concerns. A bootc
deployment replaces the immutable operating-system tree and retains user data.
The previous OS deployment remains available for rollback.

## Before the first build

### 0. Install the workstation tools

The current Mac already has Podman and `just`. Install GitHub CLI, Cosign, and
Skopeo for workflow control, signature verification, and digest inspection:

```bash
brew install gh cosign skopeo
gh auth login
```

### 1. Keep the upstream and fork remotes distinct

This checkout is configured with the personal fork as `origin` and Armada as
`upstream`:

```bash
git remote -v
```

The expected URLs are:

```text
origin    https://github.com/andrewmccament/darkmada.git
upstream  https://github.com/armada-os/armada.git
```

Use `upstream` to fetch Armada changes and `origin` for personal branches.
Push the tested branch to the fork before asking CI to build it.

### 2. Create a personal signing key

Armada's build workflow refuses to publish an unsigned image. Generate a
dedicated, password-protected Cosign key outside the repository:

```bash
mkdir -p "$HOME/.config/armada-signing"
cosign generate-key-pair \
  --output-key-prefix "$HOME/.config/armada-signing/armada"
```

Store the encrypted private key and its password as separate Actions secrets:

```bash
gh secret set SIGNING_SECRET --repo andrewmccament/darkmada \
  < "$HOME/.config/armada-signing/armada.key"
gh secret set SIGNING_PASSWORD --repo andrewmccament/darkmada
```

Add `COSIGN_PASSWORD: ${{ secrets.SIGNING_PASSWORD }}` to the signing step's
environment in `.github/workflows/build.yml`. The workflow already maps
`SIGNING_SECRET` to `COSIGN_PRIVATE_KEY`. Commit only the public key:

```bash
cp "$HOME/.config/armada-signing/armada.pub" \
  system_files/etc/pki/containers/darkmada.pub
```

The fork image should retain Armada's existing public keys for switching back
to an upstream image. Add the personal public key as a separate file, for
example:

```text
system_files/etc/pki/containers/darkmada.pub
```

Add an exact policy scope for `ghcr.io/andrewmccament/darkmada` to
`system_files/etc/containers/policy.json`. That scope should require a
`sigstoreSigned` image using the personal public key and `matchRepository`.
Also add the fork repository to
`system_files/etc/containers/registries.d/ghcr-armada.yaml` with
`use-sigstore-attachments: true`.

Finally, change the fork's build workflow to verify the published digest with
the personal public key. The upstream workflow skips its public-key verification
step when `github.event.repository.fork` is true, so a personal fork should add
its own verification instead of relying only on the signing command succeeding.

Back up the private key in an encrypted password manager or offline encrypted
archive. Losing it means existing devices cannot verify newly signed releases
without a separate trust migration.

### 3. Reuse unchanged upstream package images

The image is assembled from content-addressed package images. The current fork
workflow looks only under:

```text
ghcr.io/andrewmccament/armada/pkg/<package>:<source-hash>
```

That inherited path is also named `armada`, even though the fork is named
`darkmada`. Change `.github/workflows/packages.yml` to publish personal
packages under
`ghcr.io/andrewmccament/darkmada/pkg/<package>:<source-hash>` and resolve them
in this order:

1. Use the matching package from the fork when it exists.
2. Otherwise use `ghcr.io/armada-os/armada/pkg/<package>:<source-hash>` when
   the exact content hash exists upstream.
3. Build and publish the package in the fork only when neither image exists.

The Steam recovery patch changes `packages/armada-splash`, so that one package
should build in the fork. Packages whose source hashes match upstream can be
reused safely because the hash covers their relevant inputs.

### 4. Make the runtime image public

The Odin must be able to pull the image and its Cosign signature without a
GitHub login during bootc updates. Set the fork's `armada` GHCR package to
public. Package build intermediates may remain private if CI can authenticate
to them, but a public runtime image is the simplest device setup.

### 5. Keep a recovery path

Before the first rebase:

- Keep SSH enabled and verify key-based login.
- Keep at least 2 GiB beyond the space required by the update. Armada's update
  code reserves 2 GiB for recovery and normal operation.
- Keep a known-good Armada SD card available.
- Confirm that holding Select during boot enters Desktop Mode.
- Record the current booted image and digest.

```bash
ssh armada@<odin-ip> 'rpm-ostree status --booted'
```

## Build with GitHub Actions

The recommended personal channel is a branch with a simple container-safe name,
such as `odin`. The build workflow maps a manually dispatched non-reserved
branch directly to a tag of the same name.

```bash
git push -u origin odin
gh workflow run build.yml --repo andrewmccament/darkmada --ref odin
gh run list --repo andrewmccament/darkmada \
  --workflow build.yml --branch odin --event workflow_dispatch --limit 3
gh run watch <run-id> --repo andrewmccament/darkmada --exit-status
```

The result should be a signed image:

```text
ghcr.io/andrewmccament/darkmada:odin
```

Resolve and record its immutable digest before deployment:

```bash
skopeo inspect --format '{{.Digest}}' \
  docker://ghcr.io/andrewmccament/darkmada:odin
```

Verify the digest with the personal public key:

```bash
cosign verify \
  --key system_files/etc/pki/containers/darkmada.pub \
  ghcr.io/andrewmccament/darkmada@sha256:<digest>
```

Do not deploy merely because the mutable tag exists. Confirm that the build
workflow passed, the signature verifies, and the digest is the build intended
for the device.

## First switch from upstream Armada to the fork

Clean up any temporary files used by an earlier live test first:

```bash
sudo rm -f \
  /etc/armada/splash.conf \
  /etc/sudoers.d/armada-recover-test \
  /var/lib/armada/boot-desktop-once \
  /etc/systemd/system/armada-session-default.service.d/recover-desktop.conf
sudo systemctl daemon-reload
```

Check the device before staging the new deployment:

```bash
df -h / /var
sudo bootc status
```

Then switch the bootc origin to the personal tag:

```bash
sudo bootc switch --enforce-container-sigpolicy \
  ghcr.io/andrewmccament/darkmada:odin
```

Inspect the staged deployment before rebooting:

```bash
sudo bootc status
```

Reboot only after the staged image points to the fork and the expected digest:

```bash
sudo systemctl reboot
```

After reconnecting, verify the booted origin, digest, and version:

```bash
rpm-ostree status --booted
sudo bootc status
cat /etc/os-release
```

Test both Gaming Mode and Desktop Mode before considering the deployment good.

## Updating later builds

When a new signed image is published to the same `odin` tag, Armada's updater
can follow that nonstandard tag because the booted origin includes it. For an
explicit development update:

```bash
sudo bootc upgrade
sudo bootc status
sudo systemctl reboot
```

Verify the booted digest after reconnecting. Avoid starting a second update
while a deployment is already staged.

## Rollback and return to upstream

If the new deployment boots but is broken:

```bash
sudo bootc rollback
sudo systemctl reboot
```

If the graphical session is unusable, boot Desktop Mode by holding Select and
run the rollback from Konsole or SSH.

To return the update origin to upstream Armada while retaining the personal
fork deployment as the rollback entry:

```bash
sudo bootc switch --enforce-container-sigpolicy \
  ghcr.io/armada-os/armada:beta
sudo bootc status
sudo systemctl reboot
```

Use the upstream channel that was intended for the device; `beta` is only an
example.

## Building a flashable image

The fork's `Build disk image` workflow can build a flashable image from an
already-published container tag. Dispatch it with `custom_tag` set to `odin`,
then download the `armada-disk-image` artifact and verify its adjacent SHA-256
file.

Build a disk image when preparing recovery media or reinstalling. Updating an
existing internal installation through bootc is faster and keeps the previous
deployment available for rollback.

The local equivalent is:

```bash
just build-armada-image ghcr.io/andrewmccament/darkmada odin
```

That recipe requires a Linux environment with privileged containers and loop
devices. GitHub's ARM runner is a better fit than a macOS Podman VM. The current
Mac also has limited free disk space, while the image builder creates a large
temporary root filesystem and container store.

## Recommended deployment automation

Put the real automation in a deterministic script or `just` recipe, for
example `just odin-deploy`. A Copilot slash command can call that recipe and
explain its result, but it should not contain the deployment logic or secrets.

The deploy recipe should:

1. Refuse a dirty working tree unless explicitly overridden.
2. Run `just check`.
3. Confirm the desired commit exists on the fork branch.
4. Dispatch and watch the GitHub image workflow.
5. Resolve the published digest and verify its Cosign signature.
6. Check the SSH host key, device model, free space, current bootc state, and
   absence of another staged deployment.
7. Run `bootc switch` for the first fork deployment or `bootc upgrade` for an
   existing fork deployment.
8. Verify that the staged digest matches the digest inspected from GHCR.
9. Ask before rebooting so recording, logs, or unsaved desktop work are not
   interrupted.
10. Reconnect after reboot and verify the booted digest and session health.

Keep the Odin address, image repository, tag, and expected device identity in
an ignored local configuration file. Keep GitHub tokens, SSH private keys,
Cosign private keys, and sudo passwords out of the repository and Copilot
prompt files.

A VS Code Copilot prompt file such as
`.github/prompts/odin-update.prompt.md` can provide a `/odin-update` entry
point. Its job should be limited to gathering the requested tag, running the
deterministic deploy recipe, and summarizing verification or rollback steps.

## Suggested implementation order

1. Add the fork remote and push the current tested branch.
2. Add personal signing trust and configure `SIGNING_SECRET`.
3. Add upstream package fallback to the fork's package resolver.
4. Run the first CI container build and verify its signature.
5. Implement `just odin-deploy` with dry-run and stage-only defaults.
6. Switch the Odin to the fork image and verify it.
7. Add the Copilot prompt as a thin front end to the tested recipe.
8. Build a recovery SD image from the same signed digest.
