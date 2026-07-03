import Foundation

public enum TrackCoreElevationSource: String, Codable, Equatable, Sendable {
    case barometer = "BAROMETER"
    case gnss = "GNSS"
    case none = "NONE"
}

public struct TrackCoreProcessResponse: Codable, Equatable, Sendable {
    public var ok: Bool
    public var result: TrackCoreResult?
    public var error: TrackCoreError?

    public init(ok: Bool, result: TrackCoreResult? = nil, error: TrackCoreError? = nil) {
        self.ok = ok
        self.result = result
        self.error = error
    }
}

public enum TrackCoreResponseDecodeError: Error, Equatable, Sendable {
    case invalidUtf8
    case invalidJson(String)
}

public func decodeTrackCoreProcessResponse(_ responseJson: String) throws -> TrackCoreProcessResponse {
    guard let data = responseJson.data(using: .utf8) else {
        throw TrackCoreResponseDecodeError.invalidUtf8
    }
    do {
        return try JSONDecoder().decode(TrackCoreProcessResponse.self, from: data)
    } catch {
        throw TrackCoreResponseDecodeError.invalidJson(error.localizedDescription)
    }
}

public struct TrackCoreResult: Codable, Equatable, Sendable {
    public var trackPoints: [TrackCoreTrackPoint]
    public var segments: [TrackCoreSegment]
    public var gpxTrackPoints: [TrackCoreTrackPoint]
    public var summary: TrackCoreSummary

    public init(
        trackPoints: [TrackCoreTrackPoint],
        segments: [TrackCoreSegment],
        gpxTrackPoints: [TrackCoreTrackPoint],
        summary: TrackCoreSummary
    ) {
        self.trackPoints = trackPoints
        self.segments = segments
        self.gpxTrackPoints = gpxTrackPoints
        self.summary = summary
    }

    public var productSnapshot: TrackCoreProductSnapshot {
        TrackCoreProductSnapshot(
            trackPoints: trackPoints.map { TrackCoreProductTrackPoint(trackPoint: $0) },
            totalDistanceMeters: summary.totalDistanceMeters,
            totalAscentMeters: summary.totalAscentMeters,
            totalDescentMeters: summary.totalDescentMeters,
            selectedElevationSource: summary.selectedElevationSource
        )
    }
}

public struct TrackCoreProductSnapshot: Codable, Equatable, Sendable {
    public var trackPoints: [TrackCoreProductTrackPoint]
    public var totalDistanceMeters: Double
    public var totalAscentMeters: Double
    public var totalDescentMeters: Double
    public var selectedElevationSource: TrackCoreElevationSource

    public init(
        trackPoints: [TrackCoreProductTrackPoint],
        totalDistanceMeters: Double,
        totalAscentMeters: Double,
        totalDescentMeters: Double,
        selectedElevationSource: TrackCoreElevationSource
    ) {
        self.trackPoints = trackPoints
        self.totalDistanceMeters = totalDistanceMeters
        self.totalAscentMeters = totalAscentMeters
        self.totalDescentMeters = totalDescentMeters
        self.selectedElevationSource = selectedElevationSource
    }

    public func writeJson(to url: URL, encoder: JSONEncoder = TrackCoreJson.makeEncoder()) throws {
        let data = try encoder.encode(self)
        try data.write(to: url, options: [.atomic])
    }

    public static func readJson(from url: URL, decoder: JSONDecoder = JSONDecoder()) throws -> Self {
        let data = try Data(contentsOf: url)
        return try decoder.decode(Self.self, from: data)
    }

    public static func decodeJson(_ json: String, decoder: JSONDecoder = JSONDecoder()) throws -> Self {
        guard let data = json.data(using: .utf8) else {
            throw TrackCoreResponseDecodeError.invalidUtf8
        }
        do {
            return try decoder.decode(Self.self, from: data)
        } catch {
            throw TrackCoreResponseDecodeError.invalidJson(error.localizedDescription)
        }
    }
}

public struct TrackCoreProductTrackPoint: Codable, Equatable, Sendable {
    public var trackPointId: Int64
    public var sourceSampleId: Int64
    public var lat: Double
    public var lng: Double
    public var trackDirectionDegrees: Double?
    public var fixElapsedRealtimeNanos: Int64
    public var wallTimeMillis: Int64
    public var horizontalAccuracyMeters: Double
    public var distanceDeltaMeters: Double
    public var segmentId: Int64

    public init(
        trackPointId: Int64,
        sourceSampleId: Int64,
        lat: Double,
        lng: Double,
        trackDirectionDegrees: Double? = nil,
        fixElapsedRealtimeNanos: Int64,
        wallTimeMillis: Int64,
        horizontalAccuracyMeters: Double,
        distanceDeltaMeters: Double,
        segmentId: Int64
    ) {
        self.trackPointId = trackPointId
        self.sourceSampleId = sourceSampleId
        self.lat = lat
        self.lng = lng
        self.trackDirectionDegrees = trackDirectionDegrees
        self.fixElapsedRealtimeNanos = fixElapsedRealtimeNanos
        self.wallTimeMillis = wallTimeMillis
        self.horizontalAccuracyMeters = horizontalAccuracyMeters
        self.distanceDeltaMeters = distanceDeltaMeters
        self.segmentId = segmentId
    }

    public init(trackPoint: TrackCoreTrackPoint) {
        self.init(
            trackPointId: trackPoint.trackPointId,
            sourceSampleId: trackPoint.sourceSampleId,
            lat: trackPoint.lat,
            lng: trackPoint.lng,
            trackDirectionDegrees: trackPoint.trackDirectionDegrees,
            fixElapsedRealtimeNanos: trackPoint.fixElapsedRealtimeNanos,
            wallTimeMillis: trackPoint.wallTimeMillis,
            horizontalAccuracyMeters: trackPoint.horizontalAccuracyMeters,
            distanceDeltaMeters: trackPoint.distanceDeltaMeters,
            segmentId: trackPoint.segmentId
        )
    }
}

public enum TrackCoreJson {
    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}

public struct TrackCoreTrackPoint: Codable, Equatable, Sendable {
    public var trackPointId: Int64
    public var sourceSampleId: Int64
    public var lat: Double
    public var lng: Double
    public var trackDirectionDegrees: Double?
    public var fixElapsedRealtimeNanos: Int64
    public var wallTimeMillis: Int64
    public var horizontalAccuracyMeters: Double
    public var distanceDeltaMeters: Double
    public var movingTimeDeltaSeconds: Double
    public var segmentId: Int64

    public init(
        trackPointId: Int64,
        sourceSampleId: Int64,
        lat: Double,
        lng: Double,
        trackDirectionDegrees: Double? = nil,
        fixElapsedRealtimeNanos: Int64,
        wallTimeMillis: Int64,
        horizontalAccuracyMeters: Double,
        distanceDeltaMeters: Double,
        movingTimeDeltaSeconds: Double,
        segmentId: Int64
    ) {
        self.trackPointId = trackPointId
        self.sourceSampleId = sourceSampleId
        self.lat = lat
        self.lng = lng
        self.trackDirectionDegrees = trackDirectionDegrees
        self.fixElapsedRealtimeNanos = fixElapsedRealtimeNanos
        self.wallTimeMillis = wallTimeMillis
        self.horizontalAccuracyMeters = horizontalAccuracyMeters
        self.distanceDeltaMeters = distanceDeltaMeters
        self.movingTimeDeltaSeconds = movingTimeDeltaSeconds
        self.segmentId = segmentId
    }
}

public struct TrackCoreSegment: Codable, Equatable, Sendable {
    public var segmentId: Int64
    public var startTrackPointId: Int64
    public var endTrackPointId: Int64
    public var distanceMeters: Double
    public var movingTimeSeconds: Double

    public init(
        segmentId: Int64,
        startTrackPointId: Int64,
        endTrackPointId: Int64,
        distanceMeters: Double,
        movingTimeSeconds: Double
    ) {
        self.segmentId = segmentId
        self.startTrackPointId = startTrackPointId
        self.endTrackPointId = endTrackPointId
        self.distanceMeters = distanceMeters
        self.movingTimeSeconds = movingTimeSeconds
    }
}

public struct TrackCoreSummary: Codable, Equatable, Sendable {
    public var totalDistanceMeters: Double
    public var movingTimeSeconds: Double
    public var paceSecondsPerKm: Double?
    public var totalAscentMeters: Double
    public var totalDescentMeters: Double
    public var selectedElevationSource: TrackCoreElevationSource

    public init(
        totalDistanceMeters: Double,
        movingTimeSeconds: Double,
        paceSecondsPerKm: Double? = nil,
        totalAscentMeters: Double,
        totalDescentMeters: Double,
        selectedElevationSource: TrackCoreElevationSource
    ) {
        self.totalDistanceMeters = totalDistanceMeters
        self.movingTimeSeconds = movingTimeSeconds
        self.paceSecondsPerKm = paceSecondsPerKm
        self.totalAscentMeters = totalAscentMeters
        self.totalDescentMeters = totalDescentMeters
        self.selectedElevationSource = selectedElevationSource
    }
}

public struct TrackCoreError: Codable, Equatable, Sendable {
    public var code: String
    public var message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}
