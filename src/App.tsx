import React, { useState, type ChangeEvent, type DragEvent } from "react";
import { Upload, Camera, Star, Loader2, AlertCircle } from "lucide-react";

interface Prediction {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

interface Crop {
  id: number;
  dataUrl: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

interface OutfitRating {
  id: number;
  rating: number | null;
  feedback: string;
  crop: Crop;
  error?: boolean;
}

const ROBOFLOW_API_KEY = process.env.REACT_APP_ROBOFLOW_API_KEY || "";
const ROBOFLOW_MODEL_URL = process.env.REACT_APP_ROBOFLOW_MODEL_URL || "";
const CLAUDE_API_KEY = process.env.REACT_APP_CLAUDE_API_KEY || "";

// Add debug logging
console.log("Environment variables loaded:", {
  hasRoboflowKey: !!ROBOFLOW_API_KEY,
  hasRoboflowUrl: !!ROBOFLOW_MODEL_URL,
  hasClaudeKey: !!CLAUDE_API_KEY,
});

const ProcessingModal: React.FC = () => {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "1rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1rem",
          maxWidth: "400px",
          width: "90%",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div
          style={{
            width: "4rem",
            height: "4rem",
            border: "4px solid rgba(124, 58, 237, 0.2)",
            borderTop: "4px solid #7C3AED",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            transformOrigin: "center",
          }}
        />
        <h3
          style={{
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "#1F2937",
            margin: 0,
          }}
        >
          Processing Image
        </h3>
        <p
          style={{
            color: "#6B7280",
            textAlign: "center",
            margin: 0,
          }}
        >
          Please wait while we analyze your outfit...
        </p>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [outfitRatings, setOutfitRatings] = useState<OutfitRating[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setOutfitRatings([]);
      setError(null);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setOutfitRatings([]);
      setError(null);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleCameraCapture = () => {
    const cameraInput = document.getElementById(
      "cameraInput"
    ) as HTMLInputElement | null;
    if (cameraInput) cameraInput.click();
  };

  const detectPeople = async () => {
    if (!selectedFile) return;
    setIsProcessing(true);
    setError(null);

    try {
      // Convert file to base64
      const base64 = await fileToBase64(selectedFile);

      // Call Roboflow API
      const response = await fetch(ROBOFLOW_MODEL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: {
            image: base64,
          },
          api_key: ROBOFLOW_API_KEY,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Roboflow API Error:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(
          `Failed to detect people in image: ${response.statusText}`
        );
      }

      const data = await response.json();
      console.log("Raw Roboflow API Response:", data);

      if (
        !data.outputs ||
        !Array.isArray(data.outputs) ||
        data.outputs.length === 0
      ) {
        console.error("Invalid response format:", data);
        throw new Error("Invalid response format from Roboflow API");
      }

      // Get the first item from the outputs array
      const firstOutput = data.outputs[0];
      console.log("First output:", firstOutput);

      if (!firstOutput?.dynamic_crop?.predictions) {
        console.error("No predictions found in output:", firstOutput);
        throw new Error("No predictions found in the API response");
      }

      const predictions = firstOutput.dynamic_crop.predictions;
      console.log("Number of predictions:", predictions.length);
      console.log("First prediction:", predictions[0]);

      if (predictions.length === 0) {
        throw new Error("No people detected in the image");
      }

      // Create crops from the predictions
      const crops = await cropDetectedPeople(predictions);
      console.log("Created crops:", crops);

      if (crops.length === 0) {
        throw new Error("Failed to create crops from detected people");
      }

      // Rate the outfits
      await rateOutfits(crops);
    } catch (err: any) {
      console.error("Error in detectPeople:", err);
      setError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result.split(",")[1]);
        } else {
          reject(new Error("Failed to read file as base64"));
        }
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const cropDetectedPeople = async (
    predictions: Prediction[]
  ): Promise<Crop[]> => {
    if (!predictions || predictions.length === 0 || !previewUrl) {
      console.log("No predictions or preview URL available:", {
        predictions,
        previewUrl,
      });
      return [];
    }

    console.log("Starting to crop detected people:", predictions);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new window.Image();

    return new Promise((resolve) => {
      img.onload = () => {
        console.log("Image loaded, dimensions:", {
          width: img.width,
          height: img.height,
        });
        const crops: Crop[] = predictions.map((prediction, index) => {
          // The x and y coordinates from Roboflow are the center points
          const { x, y, width, height, confidence } = prediction;
          console.log(`Processing prediction ${index}:`, {
            x,
            y,
            width,
            height,
          });

          // Calculate the top-left corner coordinates
          const sourceX = Math.max(0, x - width / 2);
          const sourceY = Math.max(0, y - height / 2);

          // Ensure we don't exceed image boundaries
          const actualWidth = Math.min(width, img.width - sourceX);
          const actualHeight = Math.min(height, img.height - sourceY);

          console.log(`Crop ${index} dimensions:`, {
            sourceX,
            sourceY,
            actualWidth,
            actualHeight,
          });

          // Set canvas size to match the crop dimensions
          canvas.width = actualWidth;
          canvas.height = actualHeight;

          if (ctx) {
            ctx.clearRect(0, 0, actualWidth, actualHeight);
            ctx.drawImage(
              img,
              sourceX,
              sourceY,
              actualWidth,
              actualHeight,
              0,
              0,
              actualWidth,
              actualHeight
            );
          }

          const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.8);
          return {
            id: index,
            dataUrl: croppedDataUrl,
            bbox: { x, y, width: actualWidth, height: actualHeight },
            confidence,
          };
        });
        console.log("Created crops:", crops);
        resolve(crops);
      };

      img.onerror = (error) => {
        console.error("Error loading image:", error);
        resolve([]);
      };

      img.src = previewUrl;
    });
  };

  const rateOutfits = async (crops: Crop[]) => {
    console.log("Starting to rate outfits for", crops.length, "crops");
    const ratings: OutfitRating[] = [];
    for (const crop of crops) {
      try {
        console.log("Rating crop:", crop.id);
        const imageData = crop.dataUrl;
        const rating = await rateIndividualOutfit(imageData);
        console.log("Got rating for crop", crop.id, ":", rating);
        ratings.push({
          id: crop.id,
          rating: rating.score,
          feedback: rating.feedback,
          crop: {
            ...crop,
            dataUrl: imageData,
          },
        });
      } catch (err) {
        console.error("Error rating crop", crop.id, ":", err);
        ratings.push({
          id: crop.id,
          rating: null,
          feedback:
            err instanceof Error ? err.message : "Failed to rate outfit",
          crop: {
            ...crop,
            dataUrl: crop.dataUrl,
          },
          error: true,
        });
      }
    }
    console.log("Final ratings:", ratings);
    setOutfitRatings(ratings);
  };

  const rateIndividualOutfit = async (
    imageDataUrl: string
  ): Promise<{ score: number; feedback: string }> => {
    // Extract the base64 data, ensuring we remove any data URL prefix
    const base64Image = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");

    // Validate the base64 string
    if (!base64Image || typeof base64Image !== "string") {
      throw new Error("Invalid base64 image data");
    }

    console.log(
      "Sending request to Claude API with base64:",
      base64Image.substring(0, 50) + "..."
    );

    const apiUrl = "/api/rate-outfit";

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: 'Please rate this person\'s outfit from 0.0-10.0 (10.0 being the best). Consider style, color coordination, fit, and overall aesthetic. Provide a brief explanation for your rating. Format your response as JSON with "score" (number) and "feedback" (string) fields.',
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    console.log("Claude API response:", data);

    if (data.type === "error") {
      console.error("Claude API error:", data.error);
      throw new Error(data.error.message || "Failed to rate outfit");
    }

    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error("Invalid Claude API response format:", data);
      throw new Error("Invalid response format from Claude API");
    }

    const content = data.content[0].text;
    console.log("Claude API content:", content);

    try {
      const parsed = JSON.parse(content);
      console.log("Parsed rating:", parsed);
      return parsed;
    } catch (e) {
      console.log("Failed to parse JSON, using fallback:", e);
      const scoreMatch = content.match(/(\d+)\/10|\b(\d+)\b/);
      const score = scoreMatch ? parseInt(scoreMatch[1] || scoreMatch[2]) : 5;
      return {
        score: Math.min(Math.max(score, 1), 10),
        feedback: content,
      };
    }
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 10 }, (_, i) => (
      <Star
        key={i}
        className={`w-4 h-4 ${
          i < rating ? "text-yellow-400 fill-yellow-400" : "text-gray-300"
        }`}
      />
    ));
  };

  return (
    <div
      className="App"
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%)",
      }}
    >
      {isProcessing && <ProcessingModal />}
      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "24px 24px 48px 24px",
        }}
      >
        <h1
          style={{
            color: "#7C3AED",
            fontWeight: 700,
            fontSize: 36,
            textAlign: "center",
          }}
        >
          Rate My Fit
        </h1>
        <p style={{ color: "#6B7280", textAlign: "center", marginBottom: 32 }}>
          Upload a photo and get AI-powered outfit ratings for everyone in the
          picture
        </p>
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 24,
            marginBottom: 24,
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
          }}
        >
          <div
            style={{
              border: "2px dashed #E5E7EB",
              borderRadius: 16,
              padding: 32,
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 16,
            }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => {
              const fileInput = document.getElementById(
                "fileInput"
              ) as HTMLInputElement | null;
              if (fileInput) fileInput.click();
            }}
          >
            <input
              id="fileInput"
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              style={{ display: "none" }}
            />
            <input
              id="cameraInput"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
              style={{ display: "none" }}
            />
            {previewUrl ? (
              <div>
                <img
                  src={previewUrl}
                  alt="Preview"
                  style={{
                    maxWidth: "100%",
                    maxHeight: 300,
                    borderRadius: 12,
                    margin: "0 auto",
                    display: "block",
                  }}
                />
                <p style={{ color: "#6B7280", fontSize: 14, marginTop: 8 }}>
                  Click to change image
                </p>
              </div>
            ) : (
              <div>
                <Upload
                  className="w-12 h-12"
                  style={{ color: "#7C3AED", marginBottom: 16 }}
                />
                <p style={{ fontWeight: 500, color: "#1F2937" }}>
                  Drop your image here or click to browse
                </p>
                <p style={{ color: "#6B7280", fontSize: 14 }}>
                  Supports JPG, PNG, and other image formats
                </p>
                <button
                  type="button"
                  onClick={handleCameraCapture}
                  style={{
                    marginTop: 16,
                    background: "#7C3AED",
                    color: "#fff",
                    padding: "10px 24px",
                    borderRadius: 8,
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 15,
                  }}
                >
                  📷 Take a Photo (mobile only)
                </button>
              </div>
            )}
          </div>
          {selectedFile && (
            <div style={{ textAlign: "center" }}>
              <button
                onClick={detectPeople}
                disabled={isProcessing}
                style={{
                  background: isProcessing ? "#9CA3AF" : "#7C3AED",
                  color: "#fff",
                  padding: "12px 32px",
                  borderRadius: 8,
                  fontWeight: 600,
                  border: "none",
                  cursor: isProcessing ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 16,
                  transition: "all 0.2s ease-in-out",
                  opacity: isProcessing ? 0.8 : 1,
                }}
              >
                <Camera className="w-4 h-4" style={{ marginRight: 8 }} />
                Analyze Outfits
              </button>
            </div>
          )}
        </div>
        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#991B1B",
              border: "1px solid #FCA5A5",
              borderRadius: 8,
              padding: 16,
              marginBottom: 24,
            }}
          >
            <AlertCircle
              className="w-5 h-5"
              style={{ marginRight: 8, verticalAlign: "middle" }}
            />
            <span>{error}</span>
          </div>
        )}
        {outfitRatings.length > 0 && (
          <div>
            <h2
              style={{
                color: "#7C3AED",
                fontWeight: 700,
                fontSize: 24,
                marginBottom: 16,
              }}
            >
              Outfit Ratings
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: 24,
              }}
            >
              {outfitRatings.map((rating) => (
                <div
                  key={rating.id}
                  style={{
                    background: "#fff",
                    borderRadius: 16,
                    padding: 16,
                    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                  }}
                >
                  <img
                    src={rating.crop.dataUrl}
                    alt={`Person ${rating.id + 1}`}
                    style={{
                      width: "100%",
                      height: "auto",
                      maxHeight: "400px",
                      objectFit: "contain",
                      borderRadius: 8,
                      marginBottom: 12,
                      backgroundColor: "#f3f4f6",
                    }}
                  />
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: "#7C3AED",
                        marginBottom: 8,
                      }}
                    >
                      {rating.rating !== null ? `${rating.rating}/10` : "N/A"}
                    </div>
                    <p style={{ color: "#6B7280", fontSize: 15 }}>
                      {rating.feedback}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
