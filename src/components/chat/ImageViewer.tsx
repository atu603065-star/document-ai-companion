import { useState, useEffect } from "react";
import { X, Download, ZoomIn, ZoomOut, RotateCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageViewerProps {
  isOpen: boolean;
  imageUrl: string;
  imageName?: string;
  onClose: () => void;
}

export const ImageViewer = ({
  isOpen,
  imageUrl,
  imageName = "image",
  onClose,
}: ImageViewerProps) => {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Pinch-to-zoom state
  const [initialPinchDistance, setInitialPinchDistance] = useState<number | null>(null);
  const [initialScale, setInitialScale] = useState(1);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      setScale(1);
      setRotation(0);
      setPosition({ x: 0, y: 0 });
      setImageError(false);
      setIsLoading(true);
      setInitialPinchDistance(null);
      setInitialScale(1);
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, imageUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") handleZoomIn();
      if (e.key === "-") handleZoomOut();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.5, 5));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.5, 0.5));
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = imageName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(imageUrl, "_blank");
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  };

  // Calculate distance between two touch points
  const getTouchDistance = (touches: React.TouchList): number => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // Pinch-to-zoom with 2 fingers
    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = getTouchDistance(e.touches);
      setInitialPinchDistance(distance);
      setInitialScale(scale);
    } 
    // Single finger drag (only when zoomed in)
    else if (e.touches.length === 1 && scale > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Pinch-to-zoom
    if (e.touches.length === 2 && initialPinchDistance !== null) {
      e.preventDefault();
      const currentDistance = getTouchDistance(e.touches);
      const scaleChange = currentDistance / initialPinchDistance;
      const newScale = Math.min(Math.max(initialScale * scaleChange, 0.5), 5);
      setScale(newScale);
    } 
    // Single finger drag
    else if (isDragging && e.touches.length === 1 && scale > 1) {
      setPosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // Reset pinch zoom state when fingers are lifted
    if (e.touches.length < 2) {
      setInitialPinchDistance(null);
    }
    if (e.touches.length === 0) {
      setIsDragging(false);
    }
  };

  const handleImageLoad = () => {
    setIsLoading(false);
    setImageError(false);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setImageError(true);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex flex-col"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 border-b border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-foreground font-medium truncate max-w-[200px]">
          {imageName}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            className="text-muted-foreground hover:text-foreground"
            disabled={imageError}
          >
            <ZoomOut className="w-5 h-5" />
          </Button>
          <span className="text-sm text-muted-foreground min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            className="text-muted-foreground hover:text-foreground"
            disabled={imageError}
          >
            <ZoomIn className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRotate}
            className="text-muted-foreground hover:text-foreground"
            disabled={imageError}
          >
            <RotateCw className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            className="text-muted-foreground hover:text-foreground"
          >
            <Download className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Image Container */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {imageError ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground">
            <AlertCircle className="w-16 h-16 mb-4" />
            <p className="text-lg font-medium">Không thể tải ảnh</p>
            <p className="text-sm">Ảnh có thể đã bị xóa hoặc không tồn tại</p>
            <Button onClick={handleDownload} className="mt-4" variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Thử tải về trực tiếp
            </Button>
          </div>
        ) : (
          <>
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <img
              src={imageUrl}
              alt={imageName}
              className={`max-w-full max-h-full object-contain select-none transition-transform duration-100 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
              }}
              draggable={false}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          </>
        )}
      </div>

      {/* Mobile Controls */}
      <div
        className="md:hidden flex items-center justify-center gap-4 p-4 border-t border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <Button variant="outline" size="icon" onClick={handleZoomOut} disabled={imageError}>
          <ZoomOut className="w-5 h-5" />
        </Button>
        <Button variant="outline" size="icon" onClick={handleZoomIn} disabled={imageError}>
          <ZoomIn className="w-5 h-5" />
        </Button>
        <Button variant="outline" size="icon" onClick={handleRotate} disabled={imageError}>
          <RotateCw className="w-5 h-5" />
        </Button>
        <Button variant="default" onClick={handleDownload}>
          <Download className="w-5 h-5 mr-2" />
          Tải về
        </Button>
      </div>
    </div>
  );
};
