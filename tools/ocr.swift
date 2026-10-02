import Foundation
import Vision
import AppKit

let dir = CommandLine.arguments[1]
let files = try! FileManager.default.contentsOfDirectory(atPath: dir).filter { $0.hasSuffix(".png") }.sorted()
for f in files {
    let url = URL(fileURLWithPath: dir + "/" + f)
    guard let img = NSImage(contentsOf: url), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("\(f)\t<noimage>"); continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["zh-Hans"]
    req.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { FileHandle.standardError.write("\(f): \(error)\n".data(using: .utf8)!) }
    let texts = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    print("\(f)\t\(texts.joined(separator: " | "))")
}
