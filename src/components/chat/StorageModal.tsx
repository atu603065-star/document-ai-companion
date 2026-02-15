// @ts-nocheck
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  X,
  Camera,
  Upload,
  Image as ImageIcon,
  FileText,
  Video,
  Trash2,
  Download,
  Loader2,
  Play,
  MoreVertical,
} from "lucide-react";
import { CameraCapture } from "./CameraCapture";
import { ImageViewer } from "./ImageViewer";
import { VideoViewer } from "./VideoViewer";

interface StorageFile {
  id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_type: string;
  created_at: string;
}

interface StorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  onSelectFile?: (file: StorageFile) => void;
  selectionMode?: boolean;
}

interface DownloadProgress {
  fileId: string;
  progress: number;
}

interface UploadingItem {
  id: string;
  fileName: string;
  progress: number;
}

interface SavingItem {
  id: string;
  type: "photo" | "video";
  progress: number;
}

export const StorageModal = ({
  isOpen,
  onClose,
  currentUserId,
  onSelectFile,
  selectionMode = false,
}: StorageModalProps) => {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);
  const [selectedTab, setSelectedTab] = useState("media");
  const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
  const [cameraMode, setCameraMode] = useState<"photo" | "video" | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [savingItems, setSavingItems] = useState<SavingItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      fetchFiles();
    }
  }, [isOpen, currentUserId]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_storage")
        .select("*")
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFiles((data as StorageFile[]) || []);
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể tải danh sách file",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUploadSingle = async (file: File, uploadId: string) => {
    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `${currentUserId}/${Date.now()}_${uploadId}.${fileExt}`;

      // Use XMLHttpRequest for real progress
      const xhr = new XMLHttpRequest();
      
      const uploadPromise = new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setUploadingItems(prev => 
              prev.map(item => item.id === uploadId ? { ...item, progress } : item)
            );
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Upload failed")));
      });

      // Get presigned URL and upload
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;

      xhr.open("POST", `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/user-storage/${filePath}`);
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.setRequestHeader("x-upsert", "true");
      xhr.send(file);

      await uploadPromise;

      const { data: urlData } = supabase.storage
        .from("user-storage")
        .getPublicUrl(filePath);

      // Determine storage type
      let type = "file";
      if (file.type.startsWith("image/")) type = "image";
      else if (file.type.startsWith("video/")) type = "video";

      const { error: insertError } = await supabase
        .from("user_storage")
        .insert({
          user_id: currentUserId,
          file_url: urlData.publicUrl,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          storage_type: type,
        });

      if (insertError) throw insertError;

      return true;
    } catch (err) {
      console.error("Upload error:", err);
      return false;
    }
  };

  const handleMultipleUpload = async (files: File[]) => {
    if (files.length === 0) return;

    // Create uploading items for each file
    const newUploadingItems: UploadingItem[] = files.map((file, index) => ({
      id: `upload_${Date.now()}_${index}`,
      fileName: file.name,
      progress: 0,
    }));

    setUploadingItems(prev => [...prev, ...newUploadingItems]);

    // Upload all files in parallel
    const results = await Promise.all(
      files.map((file, index) => handleUploadSingle(file, newUploadingItems[index].id))
    );

    // Remove completed uploads from state
    setUploadingItems(prev => 
      prev.filter(item => !newUploadingItems.find(u => u.id === item.id))
    );

    const successCount = results.filter(Boolean).length;
    const failCount = results.length - successCount;

    if (successCount > 0) {
      toast({
        title: "Thành công",
        description: `Đã tải lên ${successCount} file`,
      });
      await fetchFiles();
    }
    
    if (failCount > 0) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: `Không thể tải lên ${failCount} file`,
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleMultipleUpload(Array.from(files));
    }
    e.target.value = "";
  };

  const handleDelete = async (file: StorageFile) => {
    try {
      // Extract file path from URL
      const urlParts = file.file_url.split("/");
      const filePath = urlParts.slice(-2).join("/");

      await supabase.storage.from("user-storage").remove([filePath]);
      
      const { error } = await supabase
        .from("user_storage")
        .delete()
        .eq("id", file.id);

      if (error) throw error;

      toast({
        title: "Đã xóa",
        description: "File đã được xóa khỏi kho lưu trữ",
      });
      
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      if (previewFile?.id === file.id) {
        setPreviewFile(null);
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xóa file",
      });
    }
  };

  const handleDownload = async (file: StorageFile) => {
    try {
      setDownloadProgress({ fileId: file.id, progress: 0 });

      const xhr = new XMLHttpRequest();
      xhr.open("GET", file.file_url, true);
      xhr.responseType = "blob";

      xhr.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setDownloadProgress({ fileId: file.id, progress });
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          const blob = xhr.response;
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = file.file_name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        }
        setDownloadProgress(null);
      };

      xhr.onerror = () => {
        window.open(file.file_url, "_blank");
        setDownloadProgress(null);
      };

      xhr.send();
    } catch {
      window.open(file.file_url, "_blank");
      setDownloadProgress(null);
    }
  };

  const mediaFiles = files.filter((f) => f.storage_type === "image" || f.storage_type === "video");
  const otherFiles = files.filter((f) => f.storage_type === "file");

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent 
          className="max-w-4xl h-[90vh] flex flex-col bg-card border-border p-0 [&>button]:hidden"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="p-4 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-semibold">
                {selectionMode ? "Chọn từ kho lưu trữ" : "Kho lưu trữ"}
              </DialogTitle>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </div>
          </DialogHeader>

          {/* Upload Actions */}
          <div className="p-4 border-b border-border flex gap-2 flex-wrap flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            
            <Button
              variant="outline"
              onClick={() => setCameraMode("photo")}
              disabled={uploadingItems.length > 0}
              className="gap-2"
            >
              <Camera className="w-4 h-4" />
              Chụp ảnh
            </Button>
            <Button
              variant="outline"
              onClick={() => setCameraMode("video")}
              disabled={uploadingItems.length > 0}
              className="gap-2"
            >
              <Video className="w-4 h-4" />
              Quay video
            </Button>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingItems.length > 0}
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              Tải tệp lên
            </Button>
          </div>

          {/* Upload Progress - Multiple Files */}
          {uploadingItems.length > 0 && (
            <div className="px-4 py-2 flex-shrink-0 space-y-2 max-h-32 overflow-y-auto">
              {uploadingItems.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 bg-muted/50 rounded-lg p-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                    <span className="text-sm truncate flex-1">{item.fileName}</span>
                    <span className="text-xs text-muted-foreground">{item.progress}%</span>
                  </div>
                  <Progress value={item.progress} className="h-1" />
                </div>
              ))}
            </div>
          )}

          {/* Saving Items from Camera */}
          {savingItems.length > 0 && (
            <div className="px-4 py-2 flex-shrink-0 space-y-2">
              {savingItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 bg-muted/50 rounded-lg p-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-sm flex-1">
                    Đang lưu {item.type === "photo" ? "ảnh" : "video"}...
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="mx-4 flex-shrink-0">
              <TabsTrigger value="media" className="gap-2">
                <ImageIcon className="w-4 h-4" />
                Ảnh & Video ({mediaFiles.length})
              </TabsTrigger>
              <TabsTrigger value="files" className="gap-2">
                <FileText className="w-4 h-4" />
                Tệp ({otherFiles.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="media" className="flex-1 overflow-hidden m-0 p-4">
              <ScrollArea className="h-full">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : mediaFiles.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p>Chưa có ảnh hoặc video nào</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {mediaFiles.map((file) => {
                      const isDownloading = downloadProgress?.fileId === file.id;
                      return (
                        <div
                          key={file.id}
                          className="relative group rounded-lg overflow-hidden bg-muted aspect-square cursor-pointer"
                          onClick={() => selectionMode ? onSelectFile?.(file) : setPreviewFile(file)}
                        >
                          {file.storage_type === "video" ? (
                            <div className="relative w-full h-full">
                              <video
                                src={file.file_url}
                                className="w-full h-full object-cover"
                                muted
                                preload="metadata"
                                onLoadedMetadata={(e) => {
                                  const video = e.currentTarget;
                                  video.currentTime = 0.5;
                                }}
                              />
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                                  <Play className="w-6 h-6 text-white fill-white" />
                                </div>
                              </div>
                            </div>
                          ) : (
                            <img
                              src={file.file_url}
                              alt={file.file_name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.parentElement?.classList.add('flex', 'items-center', 'justify-center');
                                const icon = document.createElement('div');
                                icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
                                e.currentTarget.parentElement?.appendChild(icon);
                              }}
                            />
                          )}
                          
                          {/* Download Progress Overlay */}
                          {isDownloading && (
                            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2">
                              <Loader2 className="w-6 h-6 animate-spin text-white" />
                              <span className="text-white text-sm font-medium">{downloadProgress?.progress}%</span>
                              <Progress value={downloadProgress?.progress} className="w-3/4 h-2" />
                            </div>
                          )}
                          
                          {/* 3-dot menu always visible in top-right corner */}
                          {!selectionMode && !isDownloading && (
                            <div className="absolute top-1 right-1 z-10">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="secondary"
                                    className="w-8 h-8 bg-black/50 hover:bg-black/70 text-white"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="bg-card border-border">
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownload(file);
                                    }}
                                  >
                                    <Download className="w-4 h-4 mr-2" />
                                    Tải về
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete(file);
                                    }}
                                    className="text-rose-500 focus:text-rose-500"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Xóa
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="files" className="flex-1 overflow-hidden m-0 p-4">
              <ScrollArea className="h-full">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : otherFiles.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p>Chưa có tệp nào</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {otherFiles.map((file) => {
                      const isDownloading = downloadProgress?.fileId === file.id;
                      return (
                        <div
                          key={file.id}
                          className={`flex items-center gap-3 p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors ${selectionMode ? "cursor-pointer" : ""}`}
                          onClick={() => selectionMode && onSelectFile?.(file)}
                        >
                          <FileText className="w-10 h-10 text-primary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{file.file_name}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatFileSize(file.file_size)}
                            </p>
                            {isDownloading && (
                              <div className="mt-1">
                                <Progress value={downloadProgress?.progress} className="h-1" />
                                <span className="text-xs text-muted-foreground">{downloadProgress?.progress}%</span>
                              </div>
                            )}
                          </div>
                          {!selectionMode && (
                            <div className="flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownload(file);
                                }}
                                disabled={isDownloading}
                              >
                                {isDownloading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Download className="w-4 h-4" />
                                )}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(file);
                                }}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Image Viewer with pinch-to-zoom */}
      <ImageViewer
        isOpen={previewFile !== null && previewFile.storage_type === "image"}
        imageUrl={previewFile?.file_url || ""}
        imageName={previewFile?.file_name}
        onClose={() => setPreviewFile(null)}
      />

      {/* Video Viewer */}
      <VideoViewer
        isOpen={previewFile !== null && previewFile.storage_type === "video"}
        videoUrl={previewFile?.file_url || ""}
        videoName={previewFile?.file_name}
        onClose={() => setPreviewFile(null)}
      />

      {/* Camera Capture */}
      <CameraCapture
        isOpen={cameraMode !== null}
        onClose={() => setCameraMode(null)}
        currentUserId={currentUserId}
        mode={cameraMode || "photo"}
        onCapture={() => {
          fetchFiles();
        }}
        onSavingStart={(id, type) => {
          setSavingItems(prev => [...prev, { id, type, progress: 0 }]);
        }}
        onSavingEnd={(id) => {
          setSavingItems(prev => prev.filter(item => item.id !== id));
        }}
      />
    </>
  );
};
