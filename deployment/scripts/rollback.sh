#!/usr/bin/env bash

set -Eeuo pipefail

# --------------------------------------------------
# CloudOps Platform - Automated Rollback
# --------------------------------------------------

PROJECT_DIR="/home/ubuntu"
COMPOSE_FILE="$PROJECT_DIR/compose.ec2.yaml"
IMAGE_TAGS_FILE="$PROJECT_DIR/cloudops-image-tags.env"

BACKEND_IMAGE="mahithakkar/cloudops-backend"
FRONTEND_IMAGE="mahithakkar/cloudops-frontend"

BACKEND_SERVICE="backend"

TARGET_SHA="${1:-}"

BACKUP_FILE="${IMAGE_TAGS_FILE}.pre-rollback"
TEMP_TAGS_FILE="${IMAGE_TAGS_FILE}.tmp"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
    log "ERROR: $*"
    exit 1
}

# --------------------------------------------------
# 1. Validate input and configuration
# --------------------------------------------------

if [[ ! "$TARGET_SHA" =~ ^[a-fA-F0-9]{40}$ ]]; then
    fail "Usage: $0 <40-character-release-SHA>"
fi

[[ -f "$COMPOSE_FILE" ]] || fail "Compose file not found: $COMPOSE_FILE"
[[ -f "$IMAGE_TAGS_FILE" ]] || fail "Image tags file not found: $IMAGE_TAGS_FILE"
[[ ! -e "$BACKUP_FILE" ]] || fail "Backup already exists: $BACKUP_FILE"

log "Requested rollback release: $TARGET_SHA"

# --------------------------------------------------
# 2. Verify requested Docker images
# --------------------------------------------------

BACKEND_TAG="${BACKEND_IMAGE}:sha-${TARGET_SHA}"
FRONTEND_TAG="${FRONTEND_IMAGE}:sha-${TARGET_SHA}"

log "Checking backend image..."
docker manifest inspect "$BACKEND_TAG" >/dev/null \
    || fail "Backend image unavailable: $BACKEND_TAG"

log "Checking frontend image..."
docker manifest inspect "$FRONTEND_TAG" >/dev/null \
    || fail "Frontend image unavailable: $FRONTEND_TAG"

log "Both requested images are available."

# --------------------------------------------------
# 3. Back up current release configuration
# --------------------------------------------------

cp "$IMAGE_TAGS_FILE" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

log "Previous image tags backed up."

# --------------------------------------------------
# 4. Set requested release tags
# --------------------------------------------------

printf 'BACKEND_TAG=sha-%s\nFRONTEND_TAG=sha-%s\n' \
    "$TARGET_SHA" "$TARGET_SHA" > "$TEMP_TAGS_FILE"

chmod 600 "$TEMP_TAGS_FILE"
mv "$TEMP_TAGS_FILE" "$IMAGE_TAGS_FILE"

log "Active image tags changed to requested release."

# --------------------------------------------------
# 5. Deploy requested release
# --------------------------------------------------

DEPLOYMENT_FAILED=false

if ! docker compose \
    --env-file "$IMAGE_TAGS_FILE" \
    -f "$COMPOSE_FILE" \
    pull backend frontend; then
    log "Requested image pull failed."
    DEPLOYMENT_FAILED=true
fi

if [[ "$DEPLOYMENT_FAILED" == "false" ]]; then
    if ! docker compose \
        --env-file "$IMAGE_TAGS_FILE" \
        -f "$COMPOSE_FILE" \
        up -d --no-deps backend frontend; then
        log "Requested application deployment failed."
        DEPLOYMENT_FAILED=true
    fi
fi

# --------------------------------------------------
# 6. Validate requested release
# --------------------------------------------------

BACKEND_STATUS="unknown"
FRONTEND_STATUS="unhealthy"

if [[ "$DEPLOYMENT_FAILED" == "false" ]]; then
    log "Waiting for backend health..."

    for attempt in {1..18}; do
        BACKEND_CONTAINER=$(
            docker compose \
                --env-file "$IMAGE_TAGS_FILE" \
                -f "$COMPOSE_FILE" \
                ps -q "$BACKEND_SERVICE"
        )

        if [[ -n "$BACKEND_CONTAINER" ]]; then
            BACKEND_STATUS=$(
                docker inspect \
                    --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' \
                    "$BACKEND_CONTAINER" 2>/dev/null || true
            )
        fi

        [[ "$BACKEND_STATUS" == "healthy" ]] && break
        sleep 10
    done

    log "Backend status: $BACKEND_STATUS"

    log "Checking frontend HTTP response..."

    if curl --fail --silent --show-error --max-time 10 \
        http://localhost/ >/dev/null 2>&1; then
        FRONTEND_STATUS="healthy"
    fi

    log "Frontend status: $FRONTEND_STATUS"
fi

# --------------------------------------------------
# 7. Deployment success
# --------------------------------------------------

if [[ "$DEPLOYMENT_FAILED" == "false" &&
      "$BACKEND_STATUS" == "healthy" &&
      "$FRONTEND_STATUS" == "healthy" ]]; then

    log "SUCCESS: Release $TARGET_SHA is healthy."

    rm -f "$BACKUP_FILE"
    log "Temporary backup removed."
    exit 0
fi

# --------------------------------------------------
# 8. Automatic recovery
# --------------------------------------------------

log "Requested release failed validation."
log "Restoring previous release..."

if ! cp "$BACKUP_FILE" "$IMAGE_TAGS_FILE"; then
    fail "Could not restore previous image tags. Backup retained."
fi

if ! docker compose \
    --env-file "$IMAGE_TAGS_FILE" \
    -f "$COMPOSE_FILE" \
    pull backend frontend; then
    fail "Could not pull previous images. Backup retained."
fi

if ! docker compose \
    --env-file "$IMAGE_TAGS_FILE" \
    -f "$COMPOSE_FILE" \
    up -d --no-deps backend frontend; then
    fail "Could not redeploy previous release. Backup retained."
fi

# Verify recovery
log "Checking restored backend..."

RECOVERY_BACKEND_STATUS="unknown"

for attempt in {1..18}; do
    RECOVERY_CONTAINER=$(
        docker compose \
            --env-file "$IMAGE_TAGS_FILE" \
            -f "$COMPOSE_FILE" \
            ps -q "$BACKEND_SERVICE"
    )

    if [[ -n "$RECOVERY_CONTAINER" ]]; then
        RECOVERY_BACKEND_STATUS=$(
            docker inspect \
                --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' \
                "$RECOVERY_CONTAINER" 2>/dev/null || true
        )
    fi

    [[ "$RECOVERY_BACKEND_STATUS" == "healthy" ]] && break
    sleep 10
done

if [[ "$RECOVERY_BACKEND_STATUS" != "healthy" ]]; then
    fail "Previous release was redeployed but backend is not healthy. Backup retained."
fi

if ! curl --fail --silent --show-error --max-time 10 \
    http://localhost/ >/dev/null 2>&1; then
    fail "Previous backend is healthy, but frontend check failed. Backup retained."
fi

log "Recovery successful. Previous application release is healthy."
log "Backup retained at: $BACKUP_FILE"

exit 1
