import Foundation

public enum TrackCoreStreamingMode: Equatable, Sendable {
    case live
    case finish
}

public struct TrackCoreStreamingConfiguration: Equatable, Sendable {
    public var minimumLocationSamplesBetweenSnapshots: Int
    public var minimumSecondsBetweenSnapshots: TimeInterval

    public init(
        minimumLocationSamplesBetweenSnapshots: Int = 5,
        minimumSecondsBetweenSnapshots: TimeInterval = 5
    ) {
        self.minimumLocationSamplesBetweenSnapshots = minimumLocationSamplesBetweenSnapshots
        self.minimumSecondsBetweenSnapshots = minimumSecondsBetweenSnapshots
    }
}

public struct TrackCoreStreamingSnapshot: Equatable, Sendable {
    public var sequence: Int
    public var generatedAt: Date
    public var mode: TrackCoreStreamingMode
    public var processedEventCount: Int
    public var processedLocationSampleCount: Int
    public var responseJson: String

    public init(
        sequence: Int,
        generatedAt: Date = Date(),
        mode: TrackCoreStreamingMode,
        processedEventCount: Int,
        processedLocationSampleCount: Int,
        responseJson: String
    ) {
        self.sequence = sequence
        self.generatedAt = generatedAt
        self.mode = mode
        self.processedEventCount = processedEventCount
        self.processedLocationSampleCount = processedLocationSampleCount
        self.responseJson = responseJson
    }

    public func decodeResponse() throws -> TrackCoreProcessResponse {
        do {
            return try decodeTrackCoreProcessResponse(responseJson)
        } catch TrackCoreResponseDecodeError.invalidUtf8 {
            throw TrackCoreBridgeError.invalidResponseEncoding
        } catch TrackCoreResponseDecodeError.invalidJson(let message) {
            throw TrackCoreBridgeError.invalidResponseJson(message)
        }
    }

    public func decodeProductSnapshot() throws -> TrackCoreProductSnapshot {
        try TrackCoreProductSnapshot.decodeJson(responseJson)
    }
}

public actor TrackCoreStreamingEngine {
    private let bridge: TrackCoreBridge
    private let configuration: TrackCoreStreamingConfiguration
    private var evidenceLines: [String] = []
    private var eventCount = 0
    private var locationSampleCount = 0
    private var lastSnapshotLocationSampleCount = 0
    private var lastSnapshotAt: Date?
    private var snapshotSequence = 0

    public init(
        bridge: TrackCoreBridge = TrackCoreBridge(),
        configuration: TrackCoreStreamingConfiguration = TrackCoreStreamingConfiguration()
    ) {
        self.bridge = bridge
        self.configuration = configuration
    }

    @discardableResult
    public func appendEvidenceLine(_ line: String, now: Date = Date()) throws -> TrackCoreStreamingSnapshot? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        evidenceLines.append(trimmed)
        eventCount += 1
        if isLocationSampleLine(trimmed) {
            locationSampleCount += 1
        }

        guard shouldEmitLiveSnapshot(now: now) else { return nil }
        return try makeSnapshot(mode: .live, now: now)
    }

    @discardableResult
    public func appendEvidenceLines(_ lines: [String], now: Date = Date()) throws -> TrackCoreStreamingSnapshot? {
        var latestSnapshot: TrackCoreStreamingSnapshot?
        for line in lines {
            latestSnapshot = try appendEvidenceLine(line, now: now) ?? latestSnapshot
        }
        return latestSnapshot
    }

    public func finish(now: Date = Date()) throws -> TrackCoreStreamingSnapshot {
        try makeSnapshot(mode: .finish, now: now)
    }

    public func reset() {
        evidenceLines.removeAll(keepingCapacity: true)
        eventCount = 0
        locationSampleCount = 0
        lastSnapshotLocationSampleCount = 0
        lastSnapshotAt = nil
        snapshotSequence = 0
    }

    public var bufferedEventCount: Int {
        eventCount
    }

    public var bufferedLocationSampleCount: Int {
        locationSampleCount
    }

    private func shouldEmitLiveSnapshot(now: Date) -> Bool {
        let sampleDelta = locationSampleCount - lastSnapshotLocationSampleCount
        guard sampleDelta >= configuration.minimumLocationSamplesBetweenSnapshots else {
            return false
        }
        guard let lastSnapshotAt else {
            return true
        }
        return now.timeIntervalSince(lastSnapshotAt) >= configuration.minimumSecondsBetweenSnapshots
    }

    private func makeSnapshot(mode: TrackCoreStreamingMode, now: Date) throws -> TrackCoreStreamingSnapshot {
        snapshotSequence += 1
        let responseJson = try bridge.processEvidenceJsonlProductSnapshot(
            evidenceLines.joined(separator: "\n") + "\n"
        )
        lastSnapshotLocationSampleCount = locationSampleCount
        lastSnapshotAt = now
        return TrackCoreStreamingSnapshot(
            sequence: snapshotSequence,
            generatedAt: now,
            mode: mode,
            processedEventCount: eventCount,
            processedLocationSampleCount: locationSampleCount,
            responseJson: responseJson
        )
    }

    private func isLocationSampleLine(_ line: String) -> Bool {
        if let data = line.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data),
           let event = (object as? [String: Any])?["event"] as? String {
            return event == "location_sample" || event == "raw_location"
        }
        return line.contains(#""event":"location_sample""#)
            || line.contains(#""event": "location_sample""#)
            || line.contains(#""event":"raw_location""#)
            || line.contains(#""event": "raw_location""#)
    }
}
