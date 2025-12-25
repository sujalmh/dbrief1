#!/bin/bash
echo "=== Verifying Test Files ==="
echo ""

# Check Python tests
echo "Python Tests:"
for file in test_main.py test_utils.py test_schemas.py; do
    if [ -f "api/$file" ]; then
        echo "✅ api/$file exists ($(wc -l < api/$file) lines)"
    else
        echo "❌ api/$file missing"
    fi
done

echo ""
echo "TypeScript Tests:"
# Check TypeScript tests
for file in executor-context-budgeting.test.ts fastf1-tools.test.ts planner-telemetry-summary.test.ts session-metadata.test.ts; do
    if [ -f "main/__tests__/unit/$file" ]; then
        echo "✅ main/__tests__/unit/$file exists ($(wc -l < main/__tests__/unit/$file) lines)"
    else
        echo "❌ main/__tests__/unit/$file missing"
    fi
done

# Check integration test
if [ -f "main/__tests__/integration/context-budgeting-e2e.test.ts" ]; then
    echo "✅ main/__tests__/integration/context-budgeting-e2e.test.ts exists ($(wc -l < main/__tests__/integration/context-budgeting-e2e.test.ts) lines)"
else
    echo "❌ main/__tests__/integration/context-budgeting-e2e.test.ts missing"
fi

echo ""
echo "Documentation:"
if [ -f "TEST_SUMMARY.md" ]; then
    echo "✅ TEST_SUMMARY.md exists"
else
    echo "❌ TEST_SUMMARY.md missing"
fi

echo ""
echo "=== All test files verified ==="