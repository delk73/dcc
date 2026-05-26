import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { SPEC_CONSTRAINTS } from '../types/layoutSpec';

/**
 * Compliance Suite for SPEC-UI-001.
 * Runs at the command line via the local tsx test runner.
 */
function executeComplianceSuite() {
  console.log('\n====================================================');
  console.log('RUNNING COMPLIANCE SUITE: SPEC-UI-001');
  console.log('====================================================\n');

  const wideWidth = 2560;
  const wideHeight = 1440;
  const wideLayout = useWorkspaceLayout(wideWidth, wideHeight);

  if (!wideLayout.isWidescreen) {
    throw new Error('FAIL: 2560x1440 viewport incorrectly calculated as portrait layout.');
  }

  if (wideLayout.curveEditor.x >= wideLayout.atlasViewport.x) {
    throw new Error(
      'FAIL [Rule 2.1]: In widescreen, CurveEditor must sit to the left of the AtlasViewport column.'
    );
  }
  console.log('-> [PASS] Rule 2.1: Widescreen side-by-side partition validated.');

  const portraitWidth = 1080;
  const portraitHeight = 1920;
  const portraitLayout = useWorkspaceLayout(portraitWidth, portraitHeight);

  if (portraitLayout.isWidescreen) {
    throw new Error('FAIL: 1080x1920 viewport incorrectly calculated as widescreen layout.');
  }

  const curveBottomY = portraitLayout.curveEditor.y + portraitLayout.curveEditor.height;
  if (portraitLayout.atlasViewport.y < curveBottomY) {
    throw new Error(
      'FAIL [Rule 2.2]: In portrait, 2D Atlas Viewer must sit completely below the highly interactive CurveEditor.'
    );
  }
  console.log('-> [PASS] Rule 2.2: Portrait curve-first stack order validated.');

  if (wideLayout.channelStrip.x !== 0 || portraitLayout.channelStrip.x !== 0) {
    throw new Error('FAIL [Rule 1.4]: Channel strip shifted off the left monitor border frame.');
  }

  if (
    wideLayout.channelStrip.width !== SPEC_CONSTRAINTS.CHANNEL_WIDTH ||
    portraitLayout.channelStrip.width !== SPEC_CONSTRAINTS.CHANNEL_WIDTH
  ) {
    throw new Error(
      'FAIL [Rule 2.3]: Channel strip width mutated away from invariant specification.'
    );
  }
  console.log('-> [PASS] Rule 1.4 / 2.3: Left channel boundary geometry invariance validated.');

  if (portraitLayout.spaceSlider.width !== portraitWidth) {
    throw new Error(
      'FAIL [Rule 2.3]: Portrait space slider failed to claim 100% of horizontal display width.'
    );
  }
  console.log('-> [PASS] Rule 2.3: Full-width portrait tracking slider confirmed.');

  console.log('\n====================================================');
  console.log('COMPLIANCE GATE STATUS: ALL RULES PASSED');
  console.log('====================================================\n');
}

try {
  executeComplianceSuite();
  process.exit(0);
} catch (error) {
  console.error('\n====================================================');
  console.error('COMPLIANCE GATE CRITICAL FAILURE:');
  console.error((error as Error).message);
  console.error('====================================================\n');
  process.exit(1);
}
