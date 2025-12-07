#version 420

in vec2 texCoord;


layout(binding = 0) uniform sampler2D frameBufferTexture;
layout(binding = 1) uniform sampler2D depthBufferTexture;

layout(location = 0) out vec4 fragmentColor;

uniform mat4 inverseProjectionMatrix;


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


void main(){


	float fragmentDepth = texture(depthBufferTexture, texCoord).r;
	vec3 vs_normal = normalize(texture(frameBufferTexture, texCoord).xyz);
		// Normalized Device Coordinates (clip space)
	vec4 ndc = vec4(texCoord.x * 2.0 - 1.0, texCoord.y * 2.0 - 1.0, fragmentDepth * 2.0 - 1.0, 1.0);

	// Transform to view space
	vec3 vs_pos = homogenize(inverseProjectionMatrix * ndc);

	vec3 vs_tangent = perpendicular(vs_normal);
	vec3 vs_bitangent = cross(vs_normal, vs_tangent);

	mat3 tbn = mat3(vs_tangent, vs_bitangent, vs_normal); // local base





	fragmentColor = texture(frameBufferTexture, texCoord);

}

