#version 420

in vec2 texCoord;


layout(binding = 0) uniform sampler2D frameBufferTexture;
layout(binding = 1) uniform sampler2D depthBufferTexture;

layout(location = 0) out vec4 fragmentColor;

uniform mat4 inverseProjectionMatrix;
uniform mat4 projectionMatrix;

uniform int nof_samples;
uniform float hemisphere_radius;

uniform vec3 samples[64]; // need to match the cpu sample count
uniform bool gpuSampling;
uniform bool ssaoAA;
uniform float ssaoBias;

// PCG random generator for 3 16-bit unsigned ints
uvec3 pcg3d16(uvec3 v)
{
	v = v * 12829u + 47989u;

	v.x += v.y * v.z;
	v.y += v.z * v.x;
	v.z += v.x * v.y;

	v.x += v.y * v.z;
	v.y += v.z * v.x;
	v.z += v.x * v.y;

	v ^= v >> 16u;
	return v;
}

// Conversion function to move from floats to uints, and back
vec3 pcg3d16f(vec3 v)
{
	uvec3 uv = floatBitsToUint(v);
	uv ^= uv >> 16u; // Make the info be contained in the lower 16 bits

	uvec3 m = pcg3d16(uv);

	return vec3(m & 0xFFFF) / vec3(0xFFFF);

	// Construct a float with half-open range [0,1) using low 23 bits.
	// All zeroes yields 0.0, all ones yields the next smallest representable value below 1.0.
	// From https://stackoverflow.com/questions/4200224/random-noise-functions-for-glsl
	const uint ieeeMantissa = 0x007FFFFFu; // binary32 mantissa bitmask
    const uint ieeeOne      = 0x3F800000u; // 1.0 in IEEE binary32

	// Since the pcg3d16 function is only made to work for the lower 16 bits, we only use those
	// by shifting them to be the highest of the 23
	m <<= 7u;
    m &= ieeeMantissa;                     // Keep only mantissa bits (fractional part)
    m |= ieeeOne;                          // Add fractional part to 1.0

    vec3 f = uintBitsToFloat(m);           // Range [1:2]
    return f - 1.0;                        // Range [0:1]
}

#define randf pcg3d16f


vec3 homogenize(vec4 v) { return vec3((1.0 / v.w) * v); }

// Computes one vector in the plane perpendicular to v
vec3 perpendicular(vec3 v)
{
    vec3 av = abs(v); 
    if (av.x < av.y)
        if (av.x < av.z) return vec3(0.0f, -v.z, v.y);
        else return vec3(-v.y, v.x, 0.0f);
    else
        if (av.y < av.z) return vec3(-v.z, 0.0f, v.x);
        else return vec3(-v.y, v.x, 0.0f);
}

const float M_PI = 3.1415926538;

vec3 sampleHemisphereVolumeCosine(float idx)
{
	vec3 r = randf(vec3(gl_FragCoord.xy, idx));	
	vec3 ret;
	r.x *= 2 * M_PI;
	r.y = sqrt(r.y);
	r.y = min(r.y, 0.99);
	r.z = max(0.1, r.z);

	ret.x = r.y * cos(r.x);
	ret.y = r.y * sin(r.x);
	ret.z = sqrt(max(0, 1 - dot(ret.xy, ret.xy)));
	return ret * r.z;
}



void main(){


	float fragmentDepth = texture(depthBufferTexture, texCoord).r;

	// if its the background of the scene
	if(fragmentDepth >= 1.0){
		fragmentColor = vec4(1.0);
		return;
	}

	vec3 vs_normal = normalize(texture(frameBufferTexture, texCoord).xyz);
	vs_normal = normalize(vs_normal * 2.0 - 1.0); // make normals able to be negative

	// Normalized Device Coordinates (clip space)
	vec4 ndc = vec4(texCoord.x * 2.0 - 1.0, texCoord.y * 2.0 - 1.0, fragmentDepth * 2.0 - 1.0, 1.0);

	// Transform to view space
	vec3 vs_pos = homogenize(inverseProjectionMatrix * ndc);

	vec3 vs_tangent = perpendicular(vs_normal);
	vec3 vs_bitangent = cross(vs_normal, vs_tangent);

	mat3 tbn = mat3(vs_tangent, vs_bitangent, vs_normal); // local base

    int num_visible_samples = 0; 
    int num_valid_samples = 0; 

	// get us a value between 0 and 2PI
	float randValue = randf(vec3(gl_FragCoord.xy, 0.0)).x;
	randValue = randValue * 2.0 * M_PI;
	float cosTheta = cos(randValue);
	float sinTheta = sin(randValue);

	if(gpuSampling){
		for (int i = 0; i < nof_samples; i++) {
			// Project an hemishere sample onto the local base
			vec3 s = sampleHemisphereVolumeCosine(i);

			if(ssaoAA){	
				float sampleX = s.x;
				float sampleY = s.y;
				s.x = sampleX * cosTheta - sampleY * sinTheta;
				s.y = sampleX * sinTheta + sampleY * cosTheta;
			}

			s = tbn * s;


			// compute view-space position of sample
			vec3 vs_sample_position = vs_pos + s * hemisphere_radius;

			// compute the ndc-coords of the sample
			vec3 sample_coords_ndc = homogenize(projectionMatrix * vec4(vs_sample_position, 1.0));

			// turn it to 0 to 1
			vec2 sample_coords = sample_coords_ndc.xy * 0.5 + 0.5;

			// Sample the depth-buffer at a texture coord based on the ndc-coord of the sample
			float blocker_depth = texture(depthBufferTexture, sample_coords).r;

			// Find the view-space coord of the blocker
			vec3 vs_blocker_pos = homogenize(inverseProjectionMatrix * vec4(sample_coords.xy, blocker_depth * 2.0 - 1.0, 1.0));    

			// if the blocker is not within radius
			if (abs(vs_pos.z - vs_blocker_pos.z) > hemisphere_radius){
				num_visible_samples++;
			} else {
				// if there is a blocker and its infront of the sample
				if(vs_blocker_pos.z > vs_sample_position.z + ssaoBias){
					// its not visible
				} else { // the blocker is behind
					num_visible_samples++;
				}
			}

			num_valid_samples++;
		}

	} else {

		for(int i = 0; i < 64; i++){
			vec3 s = samples[i];

			if(ssaoAA){	
				float sampleX = s.x;
				float sampleY = s.y;
				s.x = sampleX * cosTheta - sampleY * sinTheta;
				s.y = sampleX * sinTheta + sampleY * cosTheta;
			}

			s = tbn * s;

			// compute view-space position of sample
			vec3 vs_sample_position = vs_pos + s * hemisphere_radius;

			// compute the ndc-coords of the sample
			vec3 sample_coords_ndc = homogenize(projectionMatrix * vec4(vs_sample_position, 1.0));

			// turn it to 0 to 1
			vec2 sample_coords = sample_coords_ndc.xy * 0.5 + 0.5;

			// Sample the depth-buffer at a texture coord based on the ndc-coord of the sample
			float blocker_depth = texture(depthBufferTexture, sample_coords).r;

			// Find the view-space coord of the blocker    
			vec3 vs_blocker_pos = homogenize(inverseProjectionMatrix * vec4(sample_coords_ndc.xy, blocker_depth * 2.0 - 1.0, 1.0));

			// if the blocker is not within radius
			if (abs(vs_pos.z - vs_blocker_pos.z) > hemisphere_radius){
				num_visible_samples++;
			} else {
				// if there is a blocker and its infront of the sample
				if(vs_blocker_pos.z > vs_sample_position.z + ssaoBias){
					// its not visible
				} else { // the blocker is behind
					num_visible_samples++;
				}
			}

			num_valid_samples++;

		}

	}

	float visibility = 1.0;

	if (num_valid_samples > 0)
	{
		visibility = float(num_visible_samples) / float(num_valid_samples);
	}


	fragmentColor = vec4(vec3(visibility),1);

}

