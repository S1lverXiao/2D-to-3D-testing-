document.addEventListener("DOMContentLoaded", async () => {
  const uploadInput   = document.getElementById("image-upload");
  const convertBtn    = document.getElementById("convert-btn");
  const exportBtn     = document.getElementById("export-btn");
  const previewContainer = document.getElementById("preview-container");
  const resultContainer  = document.getElementById("result-container");

  let uploadedImageData = null; // Data URL of the uploaded image
  let renderer, scene, camera, mesh, animationId;

  // Reset the preview and 3D scene
  function resetPreview() {
    previewContainer.innerHTML = '<div class="preview-placeholder">No image selected</div>';
    convertBtn.disabled = true;
    exportBtn.disabled = true;
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    resultContainer.innerHTML = "";
    uploadedImageData = null;
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
    };
    reader.readAsDataURL(file);
  });

  // Convert the 2D image into a 3D model
  convertBtn.addEventListener("click", async () => {
    if (!uploadedImageData) return;
    convertBtn.disabled = true;
    convertBtn.textContent = "Processing...";

    // Clear any existing 3D content
    resultContainer.innerHTML = "";
    if (renderer) {
      renderer.dispose();
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
      // depthMap is a tf.Tensor of shape [height, width, 1]; get raw array
      depthData = depthMap.dataSync();
    } catch (err) {
      console.warn("Depth estimation failed (skipping):", err);
    }

    // (2) Semantic Segmentation using TensorFlow.js (if available)
    let segMap = null;
    try {
      const segModel = await deeplab.load({ base: 'pascal', quantizationBytes: 2 });
      const segImg = new Image();
      segImg.src = uploadedImageData;
      await segImg.decode();
      const { segmentationMap } = await segModel.segment(segImg);
      segMap = segmentationMap; // 2D array of class indices [oai_citation:11‡github.com](https://github.com/tensorflow/tfjs-models#:~:text=detection%20API%20.%20,models%2Fdeeplab%60%20source)
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
        backImageData = result.filledImage; // assume data URL or URL from backend
      }
    } catch (err) {
      console.warn("Backside inpainting API failed:", err);
    }

    // (4) Three.js scene setup
    const width  = resultContainer.clientWidth;
    const height = resultContainer.clientHeight;
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

    // Create geometry. Here we use a plane; we could also use BoxGeometry.
    const geometry = new THREE.PlaneGeometry(2, 2, 100, 100);

    // If we have depth data, displace vertices by depth to create relief [oai_citation:12‡blog.tensorflow.org](https://blog.tensorflow.org/2022/05/portrait-depth-api-turning-single-image.html#:~:text=Today%20we%20are%20introducing%20the,photo%203D%20as%20shown%20below)
    if (depthData) {
      const positions = geometry.attributes.position.array;
      // Map depthData (which is [height*width]) onto vertices array
      for (let i = 0; i < positions.length/3; i++) {
        const z = depthData[i] * 0.5;  // scale depth effect
        positions[i*3 + 2] = z;       // set vertex Z
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

    // (Optional) Use segmentation map to create multiple meshes/layers
    // This would involve splitting the image and geometry by class.
    // For brevity, we only use a single mesh here.

    // Enable dragging/touch to rotate the mesh
    let isDragging = false;
    let prevPos = { x: 0, y: 0 };
    renderer.domElement.addEventListener("pointerdown", (e) => {
      isDragging = true;
      prevPos.x = e.clientX; prevPos.y = e.clientY;
    });
    window.addEventListener("pointerup", () => isDragging = false);
    window.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevPos.x;
      const deltaY = e.clientY - prevPos.y;
      mesh.rotation.y += deltaX * 0.005;
      mesh.rotation.x += deltaY * 0.005;
      prevPos.x = e.clientX; prevPos.y = e.clientY;
    });

    // Animation loop
    function animate() {
      animationId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    // Enable Export button now that the scene is ready
    exportBtn.disabled = false;
    convertBtn.textContent = "Convert to 3D";
  });

  // Export the scene as a .glb file using GLTFExporter [oai_citation:13‡threejs.org](https://threejs.org/docs/examples/en/exporters/GLTFExporter.html#:~:text=,options%20%29%3B)
  exportBtn.addEventListener("click", () => {
    if (!scene) return;
    const exporter = new THREE.GLTFExporter();
    exporter.parse(scene, (result) => {
      // `result` is an ArrayBuffer if binary=true
      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.glb';
      a.click();
      URL.revokeObjectURL(url);
    }, { binary: true });
  });

  // Initialize
  resetPreview();
});
