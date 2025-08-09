document.addEventListener("DOMContentLoaded", async () => {
  const uploadInput      = document.getElementById("image-upload");
  const convertBtn       = document.getElementById("convert-btn");
  const exportBtn        = document.getElementById("export-btn");
  const previewContainer = document.getElementById("preview-container");
  const resultContainer  = document.getElementById("result-container");

  let uploadedImageData = null; // Data URL of the uploaded image
  let renderer, scene, camera, mesh, animationId;

  // Utility: Announce status to screen readers
  function announceStatus(message) {
    let statusDiv = document.getElementById("aria-status");
    if (!statusDiv) {
      statusDiv = document.createElement("div");
      statusDiv.id = "aria-status";
      statusDiv.setAttribute("role", "status");
      statusDiv.setAttribute("aria-live", "polite");
      statusDiv.className = "visually-hidden";
      document.body.appendChild(statusDiv);
    }
    statusDiv.textContent = message;
  }

  // Reset the preview and 3D scene
  function resetPreview() {
    previewContainer.innerHTML = '<div class="preview-placeholder">No image selected</div>';
    convertBtn.disabled = true;
    exportBtn.disabled = true;
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss && renderer.forceContextLoss();
      renderer.domElement && renderer.domElement.remove();
      renderer = null;
    }
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    resultContainer.innerHTML = "";
    uploadedImageData = null;
    announceStatus("Ready for image upload.");
  }

  // Handle file upload and show preview
  uploadInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith("image/")) {
      alert("Please upload a valid image file.");
      resetPreview();
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedImageData = e.target.result; // e.g. "data:image/png;base64,..." 

      // Display the image in the preview area
      previewContainer.innerHTML = "";
      const img = new Image();
      img.src = uploadedImageData;
      img.alt = "Uploaded image preview";
      previewContainer.appendChild(img);

      // Enable the Convert button
      convertBtn.disabled = false;
      exportBtn.disabled = true;
      announceStatus("Image uploaded. Ready to convert.");
    };
    reader.readAsDataURL(file);
  });

  // Handle window resizing for 3D canvas
  function resizeRenderer() {
    if (renderer && resultContainer && camera) {
      const width  = resultContainer.clientWidth;
      const height = resultContainer.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }
  window.addEventListener("resize", resizeRenderer);

  // Convert the 2D image into a 3D model
  convertBtn.addEventListener("click", async () => {
    if (!uploadedImageData) return;
    convertBtn.disabled = true;
    convertBtn.textContent = "Processing...";
    announceStatus("Converting image to 3D, please wait...");

    // Clear any existing 3D content
    resultContainer.innerHTML = "";
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss && renderer.forceContextLoss();
      renderer.domElement && renderer.domElement.remove();
      renderer = null;
    }
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    // (1) Depth Estimation using TensorFlow.js (if available)
    let depthData = null;
    try {
      const depthModel = await tf.depthEstimation.load();  // load Portrait Depth model
      const imgEl = new Image();
      imgEl.src = uploadedImageData;
      await imgEl.decode();
      const depthMap = await depthModel.predict(imgEl);
      depthData = depthMap.dataSync();
    } catch (err) {
      console.warn("Depth estimation failed (skipping):", err);
      announceStatus("Depth estimation unavailable; continuing without depth data.");
    }

    // (2) Semantic Segmentation using TensorFlow.js (if available)
    let segMap = null;
    try {
      const segModel = await deeplab.load({ base: 'pascal', quantizationBytes: 2 });
      const segImg = new Image();
      segImg.src = uploadedImageData;
      await segImg.decode();
      const { segmentationMap } = await segModel.segment(segImg);
      segMap = segmentationMap;
    } catch (err) {
      console.warn("Segmentation model failed (skipping):", err);
    }

    // (3) Server-side inpainting for unseen/backside (example)
    let backImageData = uploadedImageData; // fallback to original
    try {
      const response = await fetch('/api/inpaint-backside', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: uploadedImageData })
      });
      const result = await response.json();
      if (result.filledImage) {
        backImageData = result.filledImage;
      }
    } catch (err) {
      console.warn("Backside inpainting API failed:", err);
    }

    // (4) Three.js scene setup
    const width  = resultContainer.clientWidth || 512;
    const height = resultContainer.clientHeight || 512;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    resultContainer.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 3;

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(2, 2, 2);
    scene.add(light);

    // Create geometry. Here we use a plane; could use BoxGeometry or others.
    const geometry = new THREE.PlaneGeometry(2, 2, 100, 100);

    // If we have depth data, displace vertices by depth to create relief
    if (depthData) {
      const positions = geometry.attributes.position.array;
      for (let i = 0; i < positions.length / 3; i++) {
        const z = depthData[i] * 0.5;  // scale depth effect
        positions[i * 3 + 2] = z;
      }
      geometry.computeVertexNormals();
    }

    // Load textures for front and back
    const textureLoader = new THREE.TextureLoader();
    const frontTexture = textureLoader.load(uploadedImageData);
    const backTexture  = textureLoader.load(backImageData);

    // Material: double-sided to show backside texture as well
    const material = new THREE.MeshBasicMaterial({
      map: frontTexture,
      side: THREE.DoubleSide
    });

    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Enable dragging/touch to rotate the mesh
    let isDragging = false;
    let prevPos = { x: 0, y: 0 };
    renderer.domElement.onpointerdown = (e) => {
      isDragging = true;
      prevPos.x = e.clientX; prevPos.y = e.clientY;
    };
    window.onpointerup = () => isDragging = false;
    window.onpointermove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevPos.x;
      const deltaY = e.clientY - prevPos.y;
      mesh.rotation.y += deltaX * 0.005;
      mesh.rotation.x += deltaY * 0.005;
      prevPos.x = e.clientX; prevPos.y = e.clientY;
    };

    // Animation loop
    function animate() {
      animationId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    // Enable Export button now that the scene is ready
    exportBtn.disabled = false;
    convertBtn.textContent = "Convert to 3D";
    announceStatus("3D model ready. You can now export.");
    exportBtn.focus();
  });

  // Export the scene as a .glb file using GLTFExporter
  exportBtn.addEventListener("click", () => {
    if (!scene) return;
    announceStatus("Exporting 3D model...");
    const exporter = new THREE.GLTFExporter();
    exporter.parse(scene, (result) => {
      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.glb';
      a.click();
      URL.revokeObjectURL(url);
      announceStatus("Download complete.");
      exportBtn.focus();
    }, { binary: true });
  });

  // Initialize
  resetPreview();
});
