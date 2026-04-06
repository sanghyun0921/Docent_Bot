#ifndef TB3_STANDALONE_NAV__COSTMAP__EDT_HPP_
#define TB3_STANDALONE_NAV__COSTMAP__EDT_HPP_

#include <vector>
#include <cmath>
#include <algorithm>
#include "tb3_standalone_nav/visibility_control.h"

namespace tb3_standalone_nav
{
namespace costmap
{

/**
 * @class EDT
 * @brief Euclidean Distance Transform algorithm by Felzenszwalb and Huttenlocher.
 * Calculates O(dN) distance map used for costmap inflation.
 */
class EDT
{
public:
  TB3_STANDALONE_NAV_PUBLIC
  EDT(int width, int height);

  TB3_STANDALONE_NAV_PUBLIC
  ~EDT() = default;

  /**
   * @brief Computes the 2D Euclidean Distance Transform.
   * @param grid 1D array representing 2D grid. 0 = obstacle, infinity = free space.
   * @return The distance map where each cell contains the squared distance to the nearest obstacle.
   */
  TB3_STANDALONE_NAV_PUBLIC
  std::vector<double> compute_edt_2d(const std::vector<double>& grid);

private:
  void compute_edt_1d(const std::vector<double>& f, std::vector<double>& d, int n);
  
  int width_;
  int height_;
};

}  // namespace costmap
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__COSTMAP__EDT_HPP_
