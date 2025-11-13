#!/bin/bash
set -e

# Lien Release Automation Script
# Usage: npm run release -- patch|minor|major "commit message"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
BUMP_TYPE=$1
COMMIT_MSG=$2

if [ -z "$BUMP_TYPE" ] || [ -z "$COMMIT_MSG" ]; then
  echo -e "${RED}Error: Missing arguments${NC}"
  echo "Usage: npm run release -- patch|minor|major \"commit message\""
  echo ""
  echo "Examples:"
  echo "  npm run release -- patch \"fix: improve reconnection logic\""
  echo "  npm run release -- minor \"feat: add Python test detection\""
  echo "  npm run release -- major \"BREAKING: new API structure\""
  exit 1
fi

# Validate bump type
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}Error: Invalid bump type '$BUMP_TYPE'${NC}"
  echo "Must be one of: patch, minor, major"
  exit 1
fi

echo -e "${BLUE}🚀 Lien Release Process${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo -e "${YELLOW}⚠️  You have uncommitted changes${NC}"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Get current version
cd packages/cli
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${BLUE}📦 Current version: ${GREEN}$CURRENT_VERSION${NC}"

# Calculate new version
IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]}"

case $BUMP_TYPE in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo -e "${BLUE}📦 New version: ${GREEN}$NEW_VERSION${NC}"
echo ""

# Update package.json version
echo -e "${YELLOW}📝 Updating package.json...${NC}"
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json

# Build the project
cd ../..
echo -e "${YELLOW}🔨 Building project...${NC}"
npm run build

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Build failed! Rolling back version change...${NC}"
  cd packages/cli
  sed -i '' "s/\"version\": \"$NEW_VERSION\"/\"version\": \"$CURRENT_VERSION\"/" package.json
  exit 1
fi

# Update CHANGELOG.md
echo -e "${YELLOW}📋 Updating CHANGELOG.md...${NC}"
CURRENT_DATE=$(date +"%Y-%m-%d")
CHANGELOG_DATE=$(date +"%Y-%m-%d")

# Extract the type and description from commit message
if [[ $COMMIT_MSG =~ ^(feat|fix|docs|chore|refactor|test|perf|style|ci|build|revert)(\(.+\))?:\ (.+)$ ]]; then
  TYPE="${BASH_REMATCH[1]}"
  DESCRIPTION="${BASH_REMATCH[3]}"
  
  # Capitalize first letter
  DESCRIPTION="$(tr '[:lower:]' '[:upper:]' <<< ${DESCRIPTION:0:1})${DESCRIPTION:1}"
  
  # Determine changelog category
  case $TYPE in
    feat)
      CATEGORY="Added"
      ;;
    fix|perf)
      CATEGORY="Fixed"
      ;;
    docs)
      CATEGORY="Documentation"
      ;;
    refactor|style)
      CATEGORY="Changed"
      ;;
    *)
      CATEGORY="Changed"
      ;;
  esac
else
  # Fallback if commit message doesn't follow conventional commits
  CATEGORY="Changed"
  DESCRIPTION="$COMMIT_MSG"
fi

# Create changelog entry
CHANGELOG_ENTRY="## [$NEW_VERSION] - $CHANGELOG_DATE\n\n### $CATEGORY\n- **$DESCRIPTION**\n\n"

# Insert new entry after the header
if [ -f "CHANGELOG.md" ]; then
  # Create temp file with new entry
  {
    head -n 3 CHANGELOG.md
    echo -e "$CHANGELOG_ENTRY"
    tail -n +4 CHANGELOG.md
  } > CHANGELOG.md.tmp
  mv CHANGELOG.md.tmp CHANGELOG.md
else
  echo -e "${YELLOW}⚠️  CHANGELOG.md not found, skipping...${NC}"
fi

# Stage changes
echo -e "${YELLOW}📦 Staging changes...${NC}"
git add packages/cli/package.json
git add packages/cli/dist/
[ -f "CHANGELOG.md" ] && git add CHANGELOG.md

# Commit
echo -e "${YELLOW}💾 Creating commit...${NC}"
git commit -m "$COMMIT_MSG (v$NEW_VERSION)"

# Create git tag
echo -e "${YELLOW}🏷️  Creating git tag...${NC}"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION: $DESCRIPTION"

# Summary
echo ""
echo -e "${GREEN}✅ Release v$NEW_VERSION complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "📦 Version: ${GREEN}$CURRENT_VERSION${NC} → ${GREEN}$NEW_VERSION${NC}"
echo -e "💾 Commit: ${COMMIT_MSG}"
echo -e "🏷️  Tag: ${GREEN}v$NEW_VERSION${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  git push origin main"
echo -e "  git push origin v$NEW_VERSION"
echo ""

