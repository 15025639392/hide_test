import Foundation

@main
struct TrackCoreDecodeSmoke {
    static func main() throws {
        let responseJson = """
        {
          "ok": true,
          "result": {
            "trackPoints": [
              {
                "trackPointId": 1,
                "sourceSampleId": 10,
                "lat": 30.0,
                "lng": 120.0,
                "trackDirectionDegrees": null,
                "fixElapsedRealtimeNanos": 1000000000,
                "wallTimeMillis": 1000,
                "horizontalAccuracyMeters": 8.0,
                "distanceDeltaMeters": 0.0,
                "movingTimeDeltaSeconds": 0.0,
                "segmentId": 1
              }
            ],
            "segments": [
              {
                "segmentId": 1,
                "startTrackPointId": 1,
                "endTrackPointId": 1,
                "distanceMeters": 0.0,
                "movingTimeSeconds": 0.0
              }
            ],
            "gpxTrackPoints": [
              {
                "trackPointId": 1,
                "sourceSampleId": 10,
                "lat": 30.0,
                "lng": 120.0,
                "trackDirectionDegrees": null,
                "fixElapsedRealtimeNanos": 1000000000,
                "wallTimeMillis": 1000,
                "horizontalAccuracyMeters": 8.0,
                "distanceDeltaMeters": 0.0,
                "movingTimeDeltaSeconds": 0.0,
                "segmentId": 1
              }
            ],
            "summary": {
              "totalDistanceMeters": 0.0,
              "movingTimeSeconds": 0.0,
              "paceSecondsPerKm": null,
              "totalAscentMeters": 12.0,
              "totalDescentMeters": 7.0,
              "selectedElevationSource": "BAROMETER"
            }
          }
        }
        """

        let response = try decodeTrackCoreProcessResponse(responseJson)
        precondition(response.ok)
        precondition(response.result?.summary.totalAscentMeters == 12.0)
        precondition(response.result?.summary.totalDescentMeters == 7.0)
        precondition(response.result?.summary.selectedElevationSource == .barometer)
        precondition(response.result?.trackPoints.first?.sourceSampleId == 10)
        let productSnapshot = response.result?.productSnapshot
        precondition(productSnapshot?.trackPoints.count == 1)
        precondition(productSnapshot?.totalAscentMeters == 12.0)
        precondition(productSnapshot?.totalDescentMeters == 7.0)
        precondition(productSnapshot?.trackPoints.first?.distanceDeltaMeters == 0.0)
        let snapshotUrl = URL(fileURLWithPath: "/tmp/track-core-product-snapshot-smoke.json")
        try productSnapshot?.writeJson(to: snapshotUrl)
        let snapshotJson = try String(contentsOf: snapshotUrl, encoding: .utf8)
        precondition(!snapshotJson.contains("movingTimeDeltaSeconds"))
        precondition(!snapshotJson.contains("movingTimeSeconds"))
        precondition(!snapshotJson.contains("paceSecondsPerKm"))
        let roundTrippedSnapshot = try TrackCoreProductSnapshot.readJson(from: snapshotUrl)
        precondition(roundTrippedSnapshot.totalAscentMeters == 12.0)
        precondition(roundTrippedSnapshot.totalDescentMeters == 7.0)

        let streamingSnapshotJson = """
        {
          "trackPoints": [
            {
              "trackPointId": 1,
              "sourceSampleId": 10,
              "lat": 30.0,
              "lng": 120.0,
              "trackDirectionDegrees": null,
              "fixElapsedRealtimeNanos": 1000000000,
              "wallTimeMillis": 1000,
              "horizontalAccuracyMeters": 8.0,
              "distanceDeltaMeters": 0.0,
              "segmentId": 1
            }
          ],
          "totalDistanceMeters": 0.0,
          "totalAscentMeters": 12.0,
          "totalDescentMeters": 7.0,
          "selectedElevationSource": "BAROMETER"
        }
        """
        let streamingSnapshot = try TrackCoreProductSnapshot.decodeJson(streamingSnapshotJson)
        precondition(streamingSnapshot.trackPoints.count == 1)
        precondition(streamingSnapshot.totalAscentMeters == 12.0)
        precondition(streamingSnapshot.totalDescentMeters == 7.0)
        precondition(!streamingSnapshotJson.contains("movingTimeDeltaSeconds"))
        precondition(!streamingSnapshotJson.contains("movingTimeSeconds"))
        precondition(!streamingSnapshotJson.contains("paceSecondsPerKm"))

        let errorJson = """
        {
          "ok": false,
          "error": {
            "code": "invalid_jsonl",
            "message": "invalid JSONL at line 3"
          }
        }
        """
        let errorResponse = try decodeTrackCoreProcessResponse(errorJson)
        precondition(errorResponse.ok == false)
        precondition(errorResponse.error?.code == "invalid_jsonl")

        print("TrackCoreDecodeSmoke passed")
    }
}
