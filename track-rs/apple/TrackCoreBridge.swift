import Foundation

@_silgen_name("track_process_json")
private func trackProcessJson(_ input: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?

@_silgen_name("track_process_evidence_jsonl")
private func trackProcessEvidenceJsonl(_ input: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?

@_silgen_name("track_process_evidence_jsonl_product_snapshot")
private func trackProcessEvidenceJsonlProductSnapshot(_ input: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?

@_silgen_name("track_free_string")
private func trackFreeString(_ pointer: UnsafeMutablePointer<CChar>?)

public enum TrackCoreBridgeError: Error, Equatable {
    case invalidInputEncoding
    case nullResponse
    case invalidResponseEncoding
    case invalidResponseJson(String)
}

public struct TrackCoreBridge {
    public init() {}

    public func processRequestJson(_ requestJson: String) throws -> String {
        try callRust(requestJson, trackProcessJson)
    }

    public func processRequestJsonResponse(_ requestJson: String) throws -> TrackCoreProcessResponse {
        try decodeResponse(processRequestJson(requestJson))
    }

    public func processEvidenceJsonl(_ evidenceJsonl: String) throws -> String {
        try callRust(evidenceJsonl, trackProcessEvidenceJsonl)
    }

    public func processEvidenceJsonlResponse(_ evidenceJsonl: String) throws -> TrackCoreProcessResponse {
        try decodeResponse(processEvidenceJsonl(evidenceJsonl))
    }

    public func processEvidenceJsonlProductSnapshot(_ evidenceJsonl: String) throws -> String {
        try callRust(evidenceJsonl, trackProcessEvidenceJsonlProductSnapshot)
    }

    public func processEvidenceJsonlProductSnapshotValue(
        _ evidenceJsonl: String
    ) throws -> TrackCoreProductSnapshot {
        try decodeProductSnapshot(processEvidenceJsonlProductSnapshot(evidenceJsonl))
    }

    public func processEvidenceJsonl(at url: URL) throws -> String {
        let evidenceJsonl = try String(contentsOf: url, encoding: .utf8)
        return try processEvidenceJsonl(evidenceJsonl)
    }

    public func processEvidenceJsonlResponse(at url: URL) throws -> TrackCoreProcessResponse {
        let evidenceJsonl = try String(contentsOf: url, encoding: .utf8)
        return try processEvidenceJsonlResponse(evidenceJsonl)
    }

    public func processEvidenceJsonlProductSnapshot(at url: URL) throws -> String {
        let evidenceJsonl = try String(contentsOf: url, encoding: .utf8)
        return try processEvidenceJsonlProductSnapshot(evidenceJsonl)
    }

    public func processEvidenceJsonlProductSnapshotValue(at url: URL) throws -> TrackCoreProductSnapshot {
        let evidenceJsonl = try String(contentsOf: url, encoding: .utf8)
        return try processEvidenceJsonlProductSnapshotValue(evidenceJsonl)
    }

    private func callRust(
        _ input: String,
        _ function: (UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
    ) throws -> String {
        guard let inputData = input.data(using: .utf8) else {
            throw TrackCoreBridgeError.invalidInputEncoding
        }
        var bytes = [CChar](inputData.map { CChar(bitPattern: $0) })
        bytes.append(0)

        guard let outputPointer = bytes.withUnsafeBufferPointer({ buffer in
            function(buffer.baseAddress!)
        }) else {
            throw TrackCoreBridgeError.nullResponse
        }
        defer { trackFreeString(outputPointer) }

        guard let output = String(validatingUTF8: outputPointer) else {
            throw TrackCoreBridgeError.invalidResponseEncoding
        }
        return output
    }

    private func decodeResponse(_ responseJson: String) throws -> TrackCoreProcessResponse {
        do {
            return try decodeTrackCoreProcessResponse(responseJson)
        } catch TrackCoreResponseDecodeError.invalidUtf8 {
            throw TrackCoreBridgeError.invalidResponseEncoding
        } catch TrackCoreResponseDecodeError.invalidJson(let message) {
            throw TrackCoreBridgeError.invalidResponseJson(message)
        }
    }

    private func decodeProductSnapshot(_ snapshotJson: String) throws -> TrackCoreProductSnapshot {
        guard let data = snapshotJson.data(using: .utf8) else {
            throw TrackCoreBridgeError.invalidResponseEncoding
        }
        do {
            return try JSONDecoder().decode(TrackCoreProductSnapshot.self, from: data)
        } catch {
            if let errorResponse = try? JSONDecoder().decode(TrackCoreProcessResponse.self, from: data),
               errorResponse.ok == false,
               let message = errorResponse.error?.message {
                throw TrackCoreBridgeError.invalidResponseJson(message)
            }
            throw TrackCoreBridgeError.invalidResponseJson(error.localizedDescription)
        }
    }
}
