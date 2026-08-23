import CoreGraphics
import Foundation
import ImageIO
import Vision

struct RecognizedText: Codable {
    let text: String
    let confidence: Float
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
}

struct RecognitionResult: Codable {
    let imageWidth: Int
    let imageHeight: Int
    let observations: [RecognizedText]
}

struct WindowResult: Codable {
    let id: UInt32
    let owner: String
    let name: String
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
    let layer: Int
}

func writeJSON<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    FileHandle.standardOutput.write(try encoder.encode(value))
}

func recognize(imagePath: String, wordsPath: String?, fast: Bool) throws {
    let imageURL = URL(fileURLWithPath: imagePath) as CFURL
    guard let source = CGImageSourceCreateWithURL(imageURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "ArcaneVision", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to read image"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    request.minimumTextHeight = fast ? 0.008 : 0.005
    if let wordsPath,
       let data = FileManager.default.contents(atPath: wordsPath),
       let words = try? JSONDecoder().decode([String].self, from: data) {
        request.customWords = words
    }

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    let observations = (request.results ?? []).compactMap { observation -> RecognizedText? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return RecognizedText(
            text: candidate.string,
            confidence: candidate.confidence,
            x: box.origin.x,
            y: box.origin.y,
            width: box.width,
            height: box.height
        )
    }
    try writeJSON(RecognitionResult(imageWidth: image.width, imageHeight: image.height, observations: observations))
}

func makeTextRequest(words: [String], region: CGRect) -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    request.minimumTextHeight = 0.006
    request.customWords = words
    request.regionOfInterest = region
    return request
}

func recognizeGuide(imagePath: String, wordsPath: String?) throws {
    let imageURL = URL(fileURLWithPath: imagePath) as CFURL
    guard let source = CGImageSourceCreateWithURL(imageURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "ArcaneVision", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to read image"])
    }

    let words: [String]
    if let wordsPath,
       let data = FileManager.default.contents(atPath: wordsPath),
       let decoded = try? JSONDecoder().decode([String].self, from: data) {
        words = decoded
    } else {
        words = []
    }

    // Arena's deck-builder grid uses three fixed rows. Reading the narrow title
    // bands avoids spending most of the OCR budget on card rules text. The deck
    // panel remains a taller region because its row count changes as cards move.
    let regions = [
        CGRect(x: 0.0, y: 0.72, width: 0.74, height: 0.11),
        CGRect(x: 0.0, y: 0.45, width: 0.74, height: 0.11),
        CGRect(x: 0.0, y: 0.18, width: 0.74, height: 0.11),
        CGRect(x: 0.72, y: 0.08, width: 0.28, height: 0.82)
    ]
    let requests = regions.map { makeTextRequest(words: words, region: $0) }
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform(requests)

    let observations = zip(requests, regions).flatMap { request, region in
        (request.results ?? []).compactMap { observation -> RecognizedText? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return RecognizedText(
                text: candidate.string,
                confidence: candidate.confidence,
                x: region.origin.x + box.origin.x * region.width,
                y: region.origin.y + box.origin.y * region.height,
                width: box.width * region.width,
                height: box.height * region.height
            )
        }
    }
    try writeJSON(RecognitionResult(imageWidth: image.width, imageHeight: image.height, observations: observations))
}

func listWindows() throws {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    let raw = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
    let windows = raw.compactMap { entry -> WindowResult? in
        guard let id = entry[kCGWindowNumber as String] as? UInt32,
              let owner = entry[kCGWindowOwnerName as String] as? String,
              let bounds = entry[kCGWindowBounds as String] as? [String: Any],
              let x = bounds["X"] as? CGFloat,
              let y = bounds["Y"] as? CGFloat,
              let width = bounds["Width"] as? CGFloat,
              let height = bounds["Height"] as? CGFloat else { return nil }
        let name = entry[kCGWindowName as String] as? String ?? ""
        let layer = entry[kCGWindowLayer as String] as? Int ?? 0
        return WindowResult(id: id, owner: owner, name: name, x: x, y: y, width: width, height: height, layer: layer)
    }
    try writeJSON(windows)
}

do {
    let arguments = CommandLine.arguments
    guard arguments.count >= 2 else {
        throw NSError(domain: "ArcaneVision", code: 2, userInfo: [NSLocalizedDescriptionKey: "Expected ocr or windows command"])
    }
    switch arguments[1] {
    case "ocr", "ocr-fast", "ocr-guide":
        guard arguments.count >= 3 else {
            throw NSError(domain: "ArcaneVision", code: 3, userInfo: [NSLocalizedDescriptionKey: "Expected image path"])
        }
        if arguments[1] == "ocr-guide" {
            try recognizeGuide(imagePath: arguments[2], wordsPath: arguments.count >= 4 ? arguments[3] : nil)
        } else {
            try recognize(imagePath: arguments[2], wordsPath: arguments.count >= 4 ? arguments[3] : nil, fast: arguments[1] == "ocr-fast")
        }
    case "windows":
        try listWindows()
    default:
        throw NSError(domain: "ArcaneVision", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unknown command"])
    }
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
