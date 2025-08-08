// 2D-to-3D Converter - main JavaScript
// Uses Three.js (r150) to generate a depth-based 3D mesh from a 2D image.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/exporters/GLTFExporter.js';

document.addEventListener("DOMContentLoaded", () => {
  // Get DOM elements
  const uploadInput    = document.getElementById("image-upload");
  const previewContainer = document.getElementById("preview-container");
  const convertBtn     = document.getElementById("convert-btn");
  const editBtn        = document.getElementById("edit-depth-btn");
  const doneEditBtn    = document.getElementById("done-edit-btn");
  const downloadPNGBtn = document.getElementById("download-png-btn");
  const downloadGLBBtn = document.getElementById("download-glb-btn");
  const resultContainer= document.getElementById("result-container");

  // Canvas for depth editing
  let depthCanvas = null;
  let depthCtx = null;

  // State variables
  let uploadedImage = null;  // Data URL of uploaded image
  let hasEdited = false;
  let editing = false;

  // Three.js variables
  let renderer, scene, camera, controls;
  let mesh3D = null;
  let animationId = null;

  // Reset the interface and state
  function resetAll() {
    // Clear preview and 3D scene
    previewContainer.innerHTML = '<div class="preview-placeholder">No image selected</div>';
    uploadedImage = null;
    hasEdited = false;
    editing = false;
    clearThreeScene();
    // Disable buttons
    convertBtn.disabled = true;
    editBtn.disabled = true;
    downloadPNGBtn.style.display = 'none';
    downloadGLBBtn.style.display = 'none';
    convertBtn.textContent = "Convert to 3D";
    editBtn.style.display = 'inline-block';
    convertBtn.style.display = 'inline-block';
    doneEditBtn.style.display = 'none';
  }

  function clearThreeScene() {
    // Stop any animation loop
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    // Dispose renderer and remove from DOM
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer = null;
    }
    scene = camera = controls = null;
    mesh3D = null;
  }

  // Handle image upload
  uploadInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) {
      resetAll();
      return;
    }
    if (!file.type.startsWith("image/")) {
      alert("Please upload a valid image file.");
      resetAll();
      return;
    }
    // Read the file into a Data URL
    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedImage = e.target.result;
      displayImagePreview(uploadedImage);
      convertBtn.disabled = false;
      editBtn.disabled = false;
      // Reset any previous 3D rendering
      clearThreeScene();
      downloadPNGBtn.style.display = 'none';
      downloadGLBBtn.style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  // Display the uploaded image in the preview container
  function displayImagePreview(dataURL) {
    previewContainer.innerHTML = "";
    const img = document.createElement("img");
    img.id = "preview-image";
    img.src = dataURL;
    img.alt = "Uploaded Image";
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    previewContainer.appendChild(img);
  }

  // Enter depth-edit mode (overlay grayscale canvas)
  editBtn.addEventListener("click", () => {
    if (!uploadedImage) return;
    const img = document.getElementById("preview-image");
    if (!img) return;
    // Hide the preview image
    img.style.visibility = "hidden";

    // Create depth editing canvas if not yet created
    if (!depthCanvas) {
      depthCanvas = document.createElement("canvas");
      depthCanvas.id = "edit-canvas";
      depthCanvas.style.position = "absolute";
      depthCanvas.style.top = "0";
      depthCanvas.style.left = "0";
      depthCanvas.style.width = "100%";
      depthCanvas.style.height = "100%";
      depthCanvas.style.cursor = "crosshair";
      previewContainer.appendChild(depthCanvas);
      depthCtx = depthCanvas.getContext("2d");
    }
    // Match canvas size to image resolution
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    depthCanvas.width = width;
    depthCanvas.height = height;

    // Draw the image in grayscale on the canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(img, 0, 0, width, height);
    const imgData = tempCtx.getImageData(0, 0, width, height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i], g = imgData.data[i+1], b = imgData.data[i+2];
      const lum = 0.299*r + 0.587*g + 0.114*b;
      imgData.data[i] = imgData.data[i+1] = imgData.data[i+2] = lum;
    }
    depthCtx.putImageData(imgData, 0, 0);

    // Show the canvas overlay
    depthCanvas.style.display = "block";
    editing = true;
    document.getElementById("paint-controls").style.display = "flex";
    doneEditBtn.style.display = "inline-block";
    convertBtn.style.display = "none";
    editBtn.style.display = "none";

    // Painting state
    let isDrawing = false;
    let brushColor = "#000000"; // paint black by default
    let brushSize = 20;
    const brushSizeInput = document.getElementById("brush-size");
    brushSizeInput.value = brushSize;
    brushSizeInput.addEventListener("input", (e) => {
      brushSize = e.target.value;
    });

    // Brush/Eraser toggles
    const brushButton = document.getElementById("brush-btn");
    const eraserButton = document.getElementById("eraser-btn");
    function setActiveTool(tool) {
      brushColor = (tool === "brush") ? "#000000" : "#ffffff";
      if (tool === "brush") {
        brushButton.classList.add("active");
        eraserButton.classList.remove("active");
      } else {
        eraserButton.classList.add("active");
        brushButton.classList.remove("active");
      }
    }
    brushButton.addEventListener("click", () => setActiveTool("brush"));
    eraserButton.addEventListener("click", () => setActiveTool("eraser"));
    // Default to brush
    setActiveTool("brush");

    // Drawing handlers (pointer events for mouse/touch)
    depthCanvas.addEventListener("pointerdown", (ev) => {
      isDrawing = true;
      draw(ev);
    });
    depthCanvas.addEventListener("pointermove", (ev) => {
      if (isDrawing) draw(ev);
    });
    depthCanvas.addEventListener("pointerup", () => { isDrawing = false; hasEdited = true; });
    depthCanvas.addEventListener("pointerleave", () => { isDrawing = false; });

    function draw(ev) {
      const rect = depthCanvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) * (depthCanvas.width / rect.width);
      const y = (ev.clientY - rect.top)  * (depthCanvas.height / rect.height);
      depthCtx.fillStyle = brushColor;
      depthCtx.beginPath();
      depthCtx.arc(x, y, brushSize, 0, 2 * Math.PI);
      depthCtx.fill();
    }
  });

  // Exit edit mode and reveal preview image again
  doneEditBtn.addEventListener("click", () => {
    if (!editing) return;
    editing = false;
    depthCanvas.style.display = "none";
    document.getElementById("preview-image").style.visibility = "visible";
    doneEditBtn.style.display = "none";
    document.getElementById("paint-controls").style.display = "none";
    convertBtn.style.display = "inline-block";
    editBtn.style.display = "inline-block";
  });

  // Convert button: generate 3D mesh
  convertBtn.addEventListener("click", () => {
    if (!uploadedImage) return;
    convertBtn.disabled = true;
    convertBtn.textContent = "Converting...";
    create3DFromImage().then(() => {
      convertBtn.textContent = "Convert to 3D";
      convertBtn.disabled = false;
      downloadPNGBtn.style.display = 'block';
      downloadGLBBtn.style.display = 'block';
    }).catch((err) => {
      alert("Conversion failed: " + err);
      console.error(err);
      convertBtn.textContent = "Convert to 3D";
      convertBtn.disabled = false;
    });
  });

  // Core function: create 3D mesh from the image (using depth map)
  async function create3DFromImage() {
    let depthData, imgWidth, imgHeight;
    // Prepare grayscale depth data from either edited canvas or original image
    if (hasEdited) {
      // Use canvas data (already grayscale with painting)
      imgWidth = depthCanvas.width;
      imgHeight = depthCanvas.height;
      depthData = depthCtx.getImageData(0, 0, imgWidth, imgHeight).data;
    } else {
      // Auto-generate grayscale from uploaded image
      const imageElem = new Image();
      imageElem.src = uploadedImage;
      await imageElem.decode();
      // Optionally downscale for performance
      const maxDim = 512;
      let scale = 1;
      if (imageElem.naturalWidth > maxDim || imageElem.naturalHeight > maxDim) {
        scale = Math.min(maxDim / imageElem.naturalWidth, maxDim / imageElem.naturalHeight);
      }
      imgWidth = Math.floor(imageElem.naturalWidth * scale);
      imgHeight= Math.floor(imageElem.naturalHeight * scale);
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = imgWidth;
      tempCanvas.height = imgHeight;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.drawImage(imageElem, 0, 0, imgWidth, imgHeight);
      const imgData = tempCtx.getImageData(0, 0, imgWidth, imgHeight);
      // Compute grayscale
      for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i], g = imgData.data[i+1], b = imgData.data[i+2];
        const lum = 0.299*r + 0.587*g + 0.114*b;
        imgData.data[i] = imgData.data[i+1] = imgData.data[i+2] = lum;
      }
      depthData = imgData.data;
    }

    // Determine plane dimensions and segmentation
    const aspect = imgWidth / imgHeight;
    let planeWidth = (aspect >= 1) ? aspect : 1;
    let planeHeight= (aspect >= 1) ? 1 : (1 / aspect);
    const baseSegments = 100;
    let widthSeg  = Math.floor(baseSegments * (planeWidth > 1 ? planeWidth : 1));
    let heightSeg = Math.floor(baseSegments * (planeHeight> 1 ? planeHeight: 1));
    widthSeg  = Math.max(widthSeg,  10);
    heightSeg = Math.max(heightSeg, 10);

    // Set up Three.js scene
    clearThreeScene();
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(resultContainer.clientWidth, resultContainer.clientHeight);
    resultContainer.innerHTML = ""; // clear old canvas
    resultContainer.appendChild(renderer.domElement);
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(45, resultContainer.clientWidth / resultContainer.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 3);
    scene.add(camera);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2, 2, 5);
    scene.add(dirLight);

    // Create plane geometry and displace vertices
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, widthSeg, heightSeg);
    const positions = geometry.attributes.position;
    const uvs = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      const u = uvs.getX(i);
      const v = uvs.getY(i);
      const px = Math.floor(u * (imgWidth - 1));
      const py = Math.floor((1 - v) * (imgHeight - 1)); // invert Y
      const idx = (py * imgWidth + px) * 4;
      const brightness = depthData[idx]; // grayscale => R=G=B
      // Map brightness to height (invert so black=high, white=low)
      const heightVal = (1 - brightness / 255) * 0.5;
      positions.setZ(i, heightVal);
    }
    geometry.computeVertexNormals();

    // Texture: use the original image for color
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(uploadedImage);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // Material with some roughness for realistic look
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      metalness: 0.2,
      roughness: 0.8,
      side: THREE.DoubleSide
    });

    // Create mesh
    mesh3D = new THREE.Mesh(geometry, material);
    scene.add(mesh3D);

    // Orbit controls for interaction
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 1;
    controls.maxDistance = 10;
    controls.maxPolarAngle = Math.PI / 2; // limit to top-down view

    // Handle window resize
    window.addEventListener("resize", () => {
      const width = resultContainer.clientWidth;
      const height= resultContainer.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });

    // Animation loop
    function animate() {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();
  }

  // Download PNG of the current canvas view
  downloadPNGBtn.addEventListener("click", () => {
    if (!renderer) return;
    renderer.domElement.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '3dview.png';
      a.click();
    });
  });

  // Export mesh as GLB using GLTFExporter
  downloadGLBBtn.addEventListener("click", () => {
    if (!mesh3D) return;
    const exporter = new GLTFExporter();
    exporter.parse(mesh3D, (result) => {
      let output;
      if (result instanceof ArrayBuffer) {
        output = result; // binary glb
      } else {
        output = JSON.stringify(result);
      }
      const blob = new Blob([output], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.glb';
      a.click();
    }, { binary: true });
  });

  // Initialize UI
  resetAll();
});
