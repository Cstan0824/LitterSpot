import asyncio
import inspect
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


with patch.object(sqlite3, "connect", side_effect=AssertionError("SQLite must not be used by the inference service")):
    from app import main


class InferenceOnlyApiContractTests(unittest.TestCase):
    def test_runtime_routes_are_inference_only(self):
        routes = {
            route.path
            for route in main.app.routes
            if route.path not in {"/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc"}
        }
        self.assertEqual(
            routes,
            {"/health", "/analyze/frame"},
        )

    def test_frame_request_and_response_exclude_business_state(self):
        self.assertEqual(
            list(inspect.signature(main.analyze_frame).parameters),
            ["file", "floor_confidence", "localizer_confidence", "focus_region", "x_internal_token"],
        )
        response_fields = set(main.PipelineAnalysisResponse.model_fields)
        self.assertEqual(
            response_fields,
            {"image", "focusRegion", "peopleCount", "people", "bins", "floorHazards", "modelVersions", "processingTimeMs"},
        )
        self.assertTrue(
            {"analysisId", "isDemo", "imageName", "cameraId", "flags", "sourceType", "videoSessionId", "videoTimestampSeconds"}
            .isdisjoint(response_fields)
        )

    def test_lifespan_does_not_connect_to_sqlite(self):
        async def exercise_lifespan():
            with (
                patch.object(sqlite3, "connect", side_effect=AssertionError("SQLite must not be used")),
                patch.object(main.state_classifier, "load", return_value=None),
                patch.object(main.bin_localizer, "load", return_value=None),
                patch.object(main.floor_analyzer, "load", return_value=None),
            ):
                async with main.lifespan(main.app):
                    pass

        asyncio.run(exercise_lifespan())


if __name__ == "__main__":
    unittest.main()
