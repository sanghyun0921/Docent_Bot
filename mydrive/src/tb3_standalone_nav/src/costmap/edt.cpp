#include "tb3_standalone_nav/costmap/edt.hpp"

namespace tb3_standalone_nav
{
namespace costmap
{

EDT::EDT(int width, int height) : width_(width), height_(height) {}

void EDT::compute_edt_1d(const std::vector<double>& f, std::vector<double>& d, int n)
{
  std::vector<int> v(n, 0);
  std::vector<double> z(n + 1, 0.0);
  int k = 0;
  
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  
  for (int q = 1; q < n; ++q) {
    double s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2.0 * q - 2.0 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2.0 * q - 2.0 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  
  k = 0;
  for (int q = 0; q < n; ++q) {
    while (z[k + 1] < q) {
      k++;
    }
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

std::vector<double> EDT::compute_edt_2d(const std::vector<double>& grid)
{
  std::vector<double> d(width_ * height_, 0.0);
  std::vector<double> f(std::max(width_, height_), 0.0);
  std::vector<double> df(std::max(width_, height_), 0.0);
  
  // Transform along columns
  for (int x = 0; x < width_; ++x) {
    for (int y = 0; y < height_; ++y) {
      f[y] = grid[x + y * width_];
    }
    compute_edt_1d(f, df, height_);
    for (int y = 0; y < height_; ++y) {
      d[x + y * width_] = df[y];
    }
  }
  
  std::vector<double> result(width_ * height_, 0.0);
  
  // Transform along rows
  for (int y = 0; y < height_; ++y) {
    for (int x = 0; x < width_; ++x) {
      f[x] = d[x + y * width_];
    }
    compute_edt_1d(f, df, width_);
    for (int x = 0; x < width_; ++x) {
      result[x + y * width_] = df[x];
    }
  }
  
  return result;
}

}  // namespace costmap
}  // namespace tb3_standalone_nav
